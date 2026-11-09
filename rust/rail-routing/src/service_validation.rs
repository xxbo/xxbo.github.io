//! Whole-plan validation: geometry constraints, patterns, and both capacity phases.
use crate::{
    queues::Read,
    services::{compile, decode, Line},
    CORE,
};
struct View {
    headway: f64,
    calls: f64,
    compiled: bool,
    direction: i32,
    pattern_headways: Vec<f64>,
    calls_arrays: Vec<bool>,
}
fn integer(v: f64) -> bool {
    v.is_finite() && v.fract() == 0.0
}
fn point(r: &mut Read) -> (f64, f64) {
    (r.f(), r.f())
}
pub(super) fn valid(input: &[f64]) -> bool {
    let mut r = Read { v: input, at: 0 };
    assert_eq!(r.f(), 1.0);
    let n = r.u();
    let frame = &input[r.at..r.at + n];
    r.at += n;
    let (_, minute, _, _, lines, _) = decode(frame);
    let expanded = r.f() != 0.0;
    let world = r.f() != 0.0;
    let width = r.f();
    let height = r.f();
    let names = r.u();
    let nt = r.u();
    let mut kms = vec![None; names];
    let mut actual = vec![];
    for _ in 0..nt {
        let id = r.f() as i32;
        let km = r.f();
        if id >= 0 {
            let ix = id as usize;
            actual.push(ix);
            if kms[ix].is_none() {
                kms[ix] = Some(km);
            }
        }
        for _ in 0..2 {
            if r.f() != 0.0 {
                let (x, y) = point(&mut r);
                if !x.is_finite() || !y.is_finite() {
                    return false;
                }
            }
        }
        let bends = r.f();
        let count = r.u();
        let points = r.u();
        if bends < 0.0 || (bends != 0.0 && count > 120) {
            return false;
        }
        for _ in 0..points {
            let (x, y) = point(&mut r);
            if !x.is_finite()
                || !y.is_finite()
                || !world
                || x < 25.0
                || y < 25.0
                || x > width - 25.0
                || y > height - 25.0
            {
                return false;
            }
        }
    }
    let mut views = vec![];
    for l in &lines {
        let fare = r.f();
        let nf = r.u();
        let mut prev = f64::NAN;
        if fare < 0.0 || (fare != 0.0 && nf != 6) {
            return false;
        }
        for _ in 0..nf {
            let present = r.f() != 0.0;
            let v = r.f();
            if present && (!integer(v) || !(20.0..=3000.0).contains(&v) || v < prev) {
                return false;
            }
            prev = if present { v } else { f64::NAN };
        }
        let direction = r.f() as i32;
        if direction < 0 {
            return false;
        }
        let headway = r.f();
        let calls = r.f();
        let compiled = r.f() != 0.0;
        let mut pattern_headways = vec![];
        let mut calls_arrays = vec![];
        for _ in 0..l.patterns.len() {
            pattern_headways.push(r.f());
            calls_arrays.push(r.f() != 0.0);
        }
        views.push(View {
            headway,
            calls,
            compiled,
            direction,
            pattern_headways,
            calls_arrays,
        });
    }
    assert_eq!(r.at, input.len());
    for (i, l) in lines.iter().enumerate() {
        if !l.explicit {
            continue;
        }
        if l.patterns.is_empty() || l.patterns.len() > 8 {
            return false;
        }
        let mut fleet = 0.0;
        for (k, p) in l.patterns.iter().enumerate() {
            let len = l.stops.len() as f64;
            if !(0..=4).contains(&p.kind)
                || !integer(p.from)
                || !integer(p.to)
                || p.from < 0.0
                || p.to < 0.0
                || p.from >= len
                || p.to >= len
                || p.from == p.to
                || !integer(p.fleet)
                || p.fleet < 2.0
                || p.fleet % 2.0 != 0.0
            {
                return false;
            }
            if !l.managed
                && ![4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0, 20.0]
                    .contains(&views[i].pattern_headways[k])
            {
                return false;
            }
            if p.kind == 0 && (p.from != 0.0 || p.to != len - 1.0) {
                return false;
            }
            if p.kind == 1 && (p.to - p.from).abs() == len - 1.0 {
                return false;
            }
            if p.kind == 2
                && (!views[i].calls_arrays[k]
                    || p.calls.iter().any(|v| {
                        !l.stops[p.from.min(p.to) as usize..=p.from.max(p.to) as usize]
                            .iter()
                            .any(|n| n == v || n.is_nan() && v.is_nan())
                    }))
            {
                return false;
            }
            if p.kind == 4 {
                let Some(other) = usize::try_from(p.target).ok().and_then(|ix| lines.get(ix))
                else {
                    return false;
                };
                if !integer(p.end)
                    || p.end < 0.0
                    || p.end >= other.stops.len() as f64
                    || other.stops[p.end as usize] == l.stops[p.to as usize]
                {
                    return false;
                }
            }
            if compile(&lines, i, p, k as f64, minute).is_err() {
                return false;
            }
            fleet += p.fleet;
        }
        if fleet > l.fleet {
            return false;
        }
    }
    for phase in [480.0, 600.0] {
        let mut slots = vec![0.0; names];
        for (i, l) in lines.iter().enumerate() {
            if expanded {
                for (k, p) in l.patterns.iter().enumerate() {
                    let Ok(row) = compile(&lines, i, p, k as f64, phase) else {
                        return false;
                    };
                    let ns = row[5] as usize;
                    let pos = 6 + ns;
                    let nt = row[pos] as usize;
                    let tracks = &row[pos + 1..pos + 1 + nt];
                    if !tracks.iter().any(|id| actual.contains(&(*id as usize))) {
                        continue;
                    }
                    let fleet = if l.managed {
                        row[4]
                    } else if p.default {
                        l.fleet
                    } else {
                        p.fleet
                    };
                    let base = if p.default {
                        views[i].headway
                    } else {
                        views[i].pattern_headways[k]
                    };
                    let calls = row[pos + 1 + nt * 2];
                    let looped = row[6] == row[5 + ns];
                    let Some(h) = headway(l, &views[i], tracks, calls, looped, fleet, base, &kms)
                    else {
                        return false;
                    };
                    accumulate(&mut slots, tracks, h);
                }
            } else {
                if !l.tracks.iter().any(|id| actual.contains(&(*id as usize))) {
                    continue;
                }
                let fleet = if l.managed && !views[i].compiled {
                    if l.auto {
                        if crate::temporal::peak(minute) {
                            l.high
                        } else {
                            l.off
                        }
                    } else {
                        l.manual
                    }
                } else {
                    l.fleet
                };
                let looped = l.stops.first() == l.stops.last();
                let Some(h) = headway(
                    l,
                    &views[i],
                    &l.tracks,
                    views[i].calls,
                    looped,
                    fleet,
                    views[i].headway,
                    &kms,
                ) else {
                    return false;
                };
                accumulate(&mut slots, &l.tracks, h);
            }
        }
        if actual.iter().any(|&ix| slots[ix] > 30.0 + 1e-4) {
            return false;
        }
    }
    true
}
fn headway(
    l: &Line,
    v: &View,
    tracks: &[f64],
    calls: f64,
    looped: bool,
    fleet: f64,
    base: f64,
    kms: &[Option<f64>],
) -> Option<f64> {
    if l.managed && (fleet == 0.0 || fleet.is_nan()) {
        return Some(f64::INFINITY);
    }
    let mut duration = 0.0;
    for &id in tracks {
        duration += kms.get(id as usize).copied().flatten()? / 48.0 * 60.0;
    }
    duration += (calls - 1.0) * 0.6;
    let dirs = if looped && (v.direction == 2 || v.direction == 3) {
        1.0
    } else {
        2.0
    };
    let cycle = if looped {
        duration * dirs
    } else {
        2.0 * (duration + 1.0)
    };
    Some(crate::demand::max(
        if l.managed { 2.0 } else { base },
        cycle / fleet,
    ))
}
fn accumulate(slots: &mut [f64], tracks: &[f64], headway: f64) {
    let mut used = vec![false; slots.len()];
    for &id in tracks {
        let i = id as usize;
        if !used[i] {
            used[i] = true;
            slots[i] += 60.0 / headway;
        }
    }
}
#[no_mangle]
pub extern "C" fn service_validate_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn service_validate() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let ok = valid(&c.input);
        c.output = vec![1.0, if ok { 1.0 } else { 0.0 }];
        c.output.as_ptr()
    })
}

// A deletion plan preserves caller-owned metadata and is applied only after validation.
#[no_mangle]
pub extern "C" fn network_remove_line() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        c.output = remove(&c.input);
        c.output.as_ptr()
    })
}
fn remove(input: &[f64]) -> Vec<f64> {
    let mut r = Read { v: input, at: 0 };
    assert_eq!(r.f(), 1.0);
    let nl = r.u();
    let nt = r.u();
    let mut keep = vec![];
    let mut used = std::collections::HashSet::new();
    let mut exists = false;
    let mut linked = false;
    for i in 0..nl {
        let hit = r.f() != 0.0;
        exists |= hit;
        for _ in 0..r.u() {
            linked |= r.f() != 0.0;
        }
        let count = r.u();
        for _ in 0..count {
            let id = r.u();
            if !hit {
                used.insert(id);
            }
        }
        if !hit {
            keep.push(i as f64);
        }
    }
    let tracks = (0..nt)
        .filter_map(|i| {
            let id = r.u();
            used.contains(&id).then_some(i as f64)
        })
        .collect::<Vec<_>>();
    assert_eq!(r.at, input.len());
    if !exists {
        return vec![1.0, 1.0];
    }
    if linked {
        return vec![1.0, 2.0];
    }
    let mut out = vec![1.0, 0.0, keep.len() as f64];
    out.extend(keep);
    out.push(tracks.len() as f64);
    out.extend(tracks);
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_precedes_references() {
        assert_eq!(remove(&[1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0]), vec![1.0, 1.0]);
    }
    #[test]
    fn deletion_prunes_only_unused_tracks() {
        assert_eq!(
            remove(&[
                1.0, 2.0, 3.0, 1.0, 0.0, 2.0, 0.0, 1.0, 0.0, 0.0, 2.0, 1.0, 2.0, 0.0, 1.0, 2.0
            ]),
            vec![1.0, 0.0, 1.0, 1.0, 2.0, 1.0, 2.0]
        );
    }
}
