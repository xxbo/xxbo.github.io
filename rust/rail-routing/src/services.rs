//! Service compilation uses a compact descriptor ABI. Names and extra view fields stay in JS.
use crate::{queues::Read, CORE};
#[derive(Clone)]
pub(super) struct Pattern {
    pub(super) kind: i32,
    pub(super) from: f64,
    pub(super) to: f64,
    pub(super) fleet: f64,
    pub(super) calls: Vec<f64>,
    pub(super) target: i32,
    pub(super) end: f64,
    pub(super) default: bool,
}
pub(super) struct Line {
    pub(super) key: usize,
    pub(super) spec: usize,
    pub(super) managed: bool,
    pub(super) auto: bool,
    pub(super) manual: f64,
    pub(super) off: f64,
    pub(super) high: f64,
    pub(super) fleet: f64,
    pub(super) explicit: bool,
    pub(super) stops: Vec<f64>,
    pub(super) tracks: Vec<f64>,
    pub(super) patterns: Vec<Pattern>,
}
fn list(r: &mut Read) -> Vec<f64> {
    (0..r.u()).map(|_| r.f()).collect()
}
fn pattern(r: &mut Read) -> Pattern {
    let kind = r.f() as i32;
    let from = r.f();
    let to = r.f();
    let fleet = r.f();
    let target = r.f() as i32;
    let end = r.f();
    let calls = list(r);
    Pattern {
        kind,
        from,
        to,
        fleet,
        target,
        end,
        calls,
        default: false,
    }
}
fn index(v: f64, n: usize) -> Result<usize, usize> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v >= n as f64 {
        Err(7)
    } else {
        Ok(v as usize)
    }
}
fn slice(l: &Line, from: f64, to: f64) -> Result<(Vec<f64>, Vec<f64>), usize> {
    let from = index(from, l.stops.len())?;
    let to = index(to, l.stops.len())?;
    let dir = if from <= to { 1 } else { -1 };
    let mut at = from;
    let mut stops = vec![];
    let mut tracks = vec![];
    loop {
        stops.push(l.stops[at]);
        if at == to {
            break;
        }
        let i = if dir == 1 { at } else { at - 1 };
        tracks.push(*l.tracks.get(i).ok_or(7_usize)?);
        at = (at as i64 + dir) as usize;
    }
    Ok((stops, tracks))
}
fn same(a: f64, b: f64) -> bool {
    a == b || a.is_nan() && b.is_nan()
}
pub(super) fn compile(
    lines: &[Line],
    source: usize,
    p: &Pattern,
    ordinal: f64,
    minute: f64,
) -> Result<Vec<f64>, usize> {
    let l = lines.get(source).ok_or(7_usize)?;
    let (mut stops, mut tracks) = slice(l, p.from, p.to)?;
    let mut fares = vec![source as f64; tracks.len()];
    if p.kind == 4 {
        let other = if p.target < 0 {
            None
        } else {
            lines.get(p.target as usize)
        }
        .ok_or(1_usize)?;
        let join = l.stops[index(p.to, l.stops.len())?];
        let ix = other.stops.iter().position(|x| *x == join).ok_or(2_usize)?;
        if other.key == l.key {
            return Err(3);
        }
        if l.managed && other.managed && l.spec != other.spec {
            return Err(4);
        }
        let (extra_stops, extra_tracks) = slice(other, ix as f64, p.end)?;
        stops.extend_from_slice(&extra_stops[1..]);
        fares.extend(vec![p.target as f64; extra_tracks.len()]);
        tracks.extend(extra_tracks);
    }
    let mut seen = vec![];
    for &id in &stops[..stops.len().saturating_sub(1)] {
        if seen.iter().any(|x| same(*x, id)) {
            return Err(5);
        }
        seen.push(id);
    }
    if p.kind == 3 && stops.first() == stops.last() {
        return Err(6);
    }
    let calls = if p.kind == 3 {
        vec![stops[0], *stops.last().unwrap()]
    } else if p.kind == 2 {
        stops
            .iter()
            .copied()
            .filter(|id| {
                p.calls.iter().any(|x| same(*x, *id))
                    || *id == stops[0]
                    || *id == *stops.last().unwrap()
            })
            .collect()
    } else {
        stops.clone()
    };
    let (fleet_mode, fleet) = if l.managed {
        let total = if l.auto {
            if crate::temporal::peak(minute) {
                l.high
            } else {
                l.off
            }
        } else {
            l.manual
        };
        let weights = l.patterns.iter().map(|p| p.fleet).collect::<Vec<_>>();
        if !total.is_finite() || weights.iter().any(|v| !v.is_finite()) {
            return Err(8);
        }
        let allocation = crate::temporal::allocations(total, &weights);
        if ordinal.is_finite() && ordinal >= 0.0 && ordinal.fract() == 0.0 {
            allocation
                .get(ordinal as usize)
                .map_or((3.0, 0.0), |v| (2.0, *v))
        } else {
            (3.0, 0.0)
        }
    } else {
        (if p.default { 0.0 } else { 1.0 }, 0.0)
    };
    let mut out = vec![
        source as f64,
        ordinal,
        if p.default { 1.0 } else { 0.0 },
        fleet_mode,
        fleet,
        stops.len() as f64,
    ];
    out.extend(stops);
    out.push(tracks.len() as f64);
    out.extend(tracks);
    out.extend(fares);
    out.push(calls.len() as f64);
    out.extend(calls);
    Ok(out)
}
pub(super) fn decode(input: &[f64]) -> (usize, f64, usize, f64, Vec<Line>, Option<Pattern>) {
    let mut r = Read { v: input, at: 0 };
    assert_eq!(r.f(), 1.0);
    let op = r.u();
    let minute = r.f();
    let selected = r.u();
    let ordinal = r.f();
    let count = r.u();
    let mut lines = vec![];
    for _ in 0..count {
        let key = r.u();
        let spec = r.u();
        let managed = r.f() != 0.0;
        let auto = r.f() != 0.0;
        let manual = r.f();
        let off = r.f();
        let high = r.f();
        let fleet = r.f();
        let stops = list(&mut r);
        let tracks = list(&mut r);
        let explicit = r.f() != 0.0;
        let n = r.u();
        let mut patterns = (0..n).map(|_| pattern(&mut r)).collect::<Vec<_>>();
        if !explicit {
            patterns = vec![Pattern {
                kind: 0,
                from: 0.0,
                to: stops.len() as f64 - 1.0,
                fleet,
                calls: vec![],
                target: -1,
                end: f64::NAN,
                default: true,
            }];
        }
        lines.push(Line {
            key,
            spec,
            managed,
            auto,
            manual,
            off,
            high,
            fleet,
            explicit,
            stops,
            tracks,
            patterns,
        });
    }
    let single = if op == 1 { Some(pattern(&mut r)) } else { None };
    assert_eq!(r.at, input.len());
    (op, minute, selected, ordinal, lines, single)
}
fn run(input: &[f64]) -> Vec<f64> {
    let (_, minute, selected, ordinal, lines, single) = decode(input);
    let mut descriptors = vec![];
    let mut error = 0;
    if let Some(p) = single {
        match compile(&lines, selected, &p, ordinal, minute) {
            Ok(v) => descriptors.push(v),
            Err(e) => error = e,
        }
    } else {
        for (i, l) in lines.iter().enumerate() {
            for (k, p) in l.patterns.iter().enumerate() {
                match compile(&lines, i, p, k as f64, minute) {
                    Ok(v) => descriptors.push(v),
                    Err(e) => {
                        error = e;
                        break;
                    }
                }
            }
            if error != 0 {
                break;
            }
        }
    }
    if error != 0 {
        return vec![1.0, error as f64, 0.0];
    }
    let mut out = vec![1.0, 0.0, descriptors.len() as f64];
    for row in descriptors {
        out.push(row.len() as f64);
        out.extend(row);
    }
    out
}
#[no_mangle]
pub extern "C" fn service_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn service_compile() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        c.output = run(&c.input);
        c.output.as_ptr()
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reverse_slice_keeps_segment_orientation() {
        let l = Line {
            key: 0,
            spec: 0,
            managed: false,
            auto: false,
            manual: 0.0,
            off: 0.0,
            high: 0.0,
            fleet: 4.0,
            explicit: false,
            stops: vec![1.0, 2.0, 3.0],
            tracks: vec![10.0, 20.0],
            patterns: vec![],
        };
        let (s, t) = slice(&l, 2.0, 0.0).unwrap();
        assert_eq!(s, vec![3.0, 2.0, 1.0]);
        assert_eq!(t, vec![20.0, 10.0]);
    }
}
