//! Continuous simulation kernels. Decisions are returned in original iteration order;
//! JavaScript applies existing accounting events and owns save-compatible objects.
use crate::demand::{max, min};
use crate::{int, CORE};

fn motion(v: &[f64]) -> Vec<f64> {
    let now = v[1];
    let spacing = v[2];
    let nb = int(v[3]);
    let n = int(v[4]);
    assert_eq!(v.len(), 5 + nb + n * 20);
    let mut blocks = v[5..5 + nb].to_vec();
    let mut out = Vec::with_capacity(n * 8);
    for t in v[5 + nb..].chunks_exact(20) {
        let (mut action, mut progress, mut travel, mut expense) = (0.0, t[5], 0.0, 0.0);
        let (mut at, mut ready, mut final_at, mut final_ready) = (t[2], t[8], t[2], t[8]);
        if t[0] == 0.0 {
            action = 1.0;
        } else if t[1] == 1.0 {
            progress = min(1.0, (now - t[6]) / (t[7] - t[6]));
            travel = (progress - t[5]) * t[17];
            expense = travel * (180.0 + t[18] * 25.0);
            action = 2.0;
            if progress >= 1.0 - 1e-8 {
                at += t[3];
                ready = now + if t[15] != 0.0 { t[14] } else { 0.0 };
                final_at = at;
                final_ready = ready;
                action = 3.0;
                if (t[3] == 1.0 && at == t[4]) || (t[3] != 1.0 && at == 0.0) {
                    if t[9] != 0.0 && t[10] == 0.0 && t[11] != 0.0 && t[13] <= t[12] {
                        final_at = if t[3] == 1.0 { 0.0 } else { t[4] };
                        final_ready = now + if t[16] != 0.0 { t[14] } else { 0.0 };
                        action = 4.0;
                    } else {
                        action = 5.0;
                    }
                }
            }
        } else if t[1] != 3.0 && now >= t[8] && t[19] >= 0.0 {
            let block = int(t[19]);
            assert!(block < nb);
            if now < blocks[block] {
                action = 6.0;
            } else {
                action = 7.0;
                progress = 0.0;
                ready = now + max(0.001, t[17] / 48.0 * 60.0);
                final_ready = now + spacing;
                blocks[block] = final_ready;
            }
        }
        out.extend_from_slice(&[
            action,
            progress,
            travel,
            expense,
            at,
            ready,
            final_at,
            final_ready,
        ]);
    }
    out
}
fn boarding(v: &[f64]) -> Vec<f64> {
    let now = v[1];
    let mut remaining = v[2] - v[3];
    let n = int(v[4]);
    assert_eq!(v.len(), 8 + n * 4);
    let mut out = vec![0.0];
    for (i, t) in v[8..].chunks_exact(4).enumerate() {
        let count = t[0];
        let wait = now - t[1];
        let action = if count < 1e-10 {
            1.0
        } else if wait > 60.0 {
            2.0
        } else if t[3] != 0.0 && (v[7] != 0.0 || (t[2] - v[5]) * v[6] > 0.0) {
            3.0
        } else {
            0.0
        };
        if action == 0.0 {
            continue;
        }
        let take = if action == 3.0 {
            min(remaining, count)
        } else {
            count
        };
        if action == 3.0 && take <= 0.0 {
            break;
        }
        out.extend_from_slice(&[i as f64, action, take, wait]);
        out[0] += 1.0;
        if action == 3.0 {
            remaining -= take;
            if remaining < 1e-8 {
                break;
            }
        }
    }
    out
}
fn sample(v: &[f64]) -> Vec<f64> {
    let n = int(v[1]);
    let nf = int(v[2]);
    let np = int(v[3]);
    assert_eq!(v.len(), 6 + nf + np + n * 3);
    let fv = &v[6..6 + nf];
    let pv = &v[6 + nf..6 + nf + np];
    let mut weights = Vec::with_capacity(n);
    let mut total = 0.0;
    for row in v[6 + nf + np..].chunks_exact(3) {
        let f = int(row[1]);
        let p = int(row[2]);
        assert!(f < nf && p < np);
        let weight = row[0] * fv[f] * pv[p];
        assert!(weight.is_finite() && weight >= 0.0);
        weights.push(weight);
        total += weight;
    }
    sample_weights(&weights, total, v[4], v[5])
}
fn sample_weights(weights: &[f64], total: f64, carry: f64, state: f64) -> Vec<f64> {
    let accrued = carry + total;
    let count = (accrued + 1e-9).floor();
    let remainder = max(0.0, accrued - count);
    let mut out = vec![total, remainder, state, 0.0];
    if count == 0.0 || total <= 0.0 {
        return out;
    }
    assert!(count <= u32::MAX as f64);
    let seed = if state == 0.0 {
        2463534242
    } else {
        int(state) as u32
    };
    let rng = 1664525u32.wrapping_mul(seed).wrapping_add(1013904223);
    out[2] = rng as f64;
    let step = total / count;
    let mut target = rng as f64 / 4294967296.0 * step;
    let mut cumulative = 0.0;
    let mut remaining = count as u32;
    for (i, &weight) in weights.iter().enumerate() {
        if remaining == 0 {
            break;
        }
        cumulative += weight;
        let mut amount = 0u32;
        while remaining > 0 && target < cumulative {
            amount += 1;
            remaining -= 1;
            target += step;
        }
        if amount > 0 {
            out.extend_from_slice(&[i as f64, amount as f64]);
            out[3] += 1.0;
        }
    }
    if remaining > 0 {
        if let Some(i) = weights.iter().rposition(|&w| w != 0.0) {
            out.extend_from_slice(&[i as f64, remaining as f64]);
            out[3] += 1.0;
        }
    }
    out
}
fn dispatch(v: &[f64]) -> Vec<f64> {
    let now = v[1];
    let ns = int(v[2]);
    let np = int(v[3]);
    let nt = int(v[4]);
    let nr = int(v[5]);
    assert_eq!(v.len(), 6 + nt * 3 + nr * 15);
    let mut services = vec![0.0; ns];
    let mut parents = vec![0.0; np];
    let mut directions = vec![[0.0; 2]; ns];
    for t in v[6..6 + nt * 3].chunks_exact(3) {
        let s = int(t[0]);
        let p = int(t[1]);
        assert!(s < ns && p < np);
        services[s] += 1.0;
        parents[p] += 1.0;
        directions[s][if t[2] == 1.0 { 0 } else { 1 }] += 1.0;
    }
    let mut out = Vec::with_capacity(nr * 2);
    let day = ((now % 1440.0) + 1440.0) % 1440.0;
    for r in v[6 + nt * 3..].chunks_exact(15) {
        let s = int(r[0]);
        let p = int(r[1]);
        assert!(s < ns && p < np);
        let d = if r[2] == 1.0 { 0 } else { 1 };
        if r[3] == 0.0 || now + 1e-8 < r[4] {
            out.extend_from_slice(&[-1.0, r[4]]);
            continue;
        }
        let opened = day >= r[6] && day < r[7];
        let spawn = opened
            && services[s] < r[8]
            && (r[9] == 0.0 || parents[p] < r[10])
            && (r[11] == 0.0 || directions[s][d] < min(r[8] / r[12], (r[13] / r[14]).ceil()));
        if spawn {
            services[s] += 1.0;
            parents[p] += 1.0;
            directions[s][d] += 1.0;
        }
        out.extend_from_slice(&[if spawn { 1.0 } else { 0.0 }, now + r[5]]);
    }
    out
}
#[no_mangle]
pub extern "C" fn simulation_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn simulation_run() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core {
            input,
            output,
            simulation_state,
            sampling_state,
            ..
        } = &mut *c;
        *output = match int(input[0]) {
            0 => motion(input),
            1 => boarding(input),
            2 => sample(input),
            3 => dispatch(input),
            4 => persistent(input, simulation_state),
            6 => incremental(input, simulation_state),
            7 => cached_sample(input, sampling_state),
            8 | 9 => timed_sample(input, sampling_state),
            _ => panic!("unknown simulation operation"),
        };
        c.output.as_ptr()
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sampling_keeps_global_residual() {
        let out = sample(&[
            2.0, 2.0, 1.0, 1.0, 0.7, 42.0, 1.0, 1.0, 0.2, 0.0, 0.0, 0.2, 0.0, 0.0,
        ]);
        assert_eq!(out[0], 0.4);
        assert!((out[1] - 0.1).abs() < 1e-12);
        assert_eq!(out[4..].chunks_exact(2).map(|a| a[1]).sum::<f64>(), 1.0);
    }
    #[test]
    fn boarding_rejects_expired_before_boarding() {
        let out = boarding(&[
            1.0, 100.0, 10.0, 5.0, 3.0, 0.0, 1.0, 0.0, 4.0, 0.0, 1.0, 1.0, 8.0, 90.0, 1.0, 1.0,
            1.0, 90.0, 1.0, 1.0,
        ]);
        assert_eq!(out, vec![2.0, 0.0, 2.0, 4.0, 100.0, 1.0, 3.0, 5.0, 10.0]);
    }
}

pub(super) struct MotionState {
    token: f64,
    rows: Vec<[f64; 20]>,
    routes: Vec<Vec<(f64, f64)>>,
    calls: Vec<Vec<bool>>,
    blocks: usize,
    delta: crate::numbers::Map<usize, DeltaTrain>,
    order: Vec<usize>,
}
pub(super) fn persistent(v: &[f64], cache: &mut Option<MotionState>) -> Vec<f64> {
    let token = v[1];
    let now = v[2];
    let spacing = v[3];
    let load = v[4] != 0.0;
    let nb = int(v[5]);
    let releases = &v[6..6 + nb];
    let mut at = 6 + nb;
    if load {
        let n = int(v[at]);
        at += 1;
        let mut rows = Vec::with_capacity(n);
        let mut routes = Vec::with_capacity(n);
        let mut calls = Vec::with_capacity(n);
        for _ in 0..n {
            let mut row = [0.0; 20];
            row.copy_from_slice(&v[at..at + 20]);
            at += 20;
            rows.push(row);
            let nr = int(v[at]);
            at += 1;
            let mut route = Vec::with_capacity(nr);
            for _ in 0..nr {
                route.push((v[at], v[at + 1]));
                at += 2;
            }
            routes.push(route);
            let nc = int(v[at]);
            at += 1;
            let called = v[at..at + nc].iter().map(|&x| x != 0.0).collect();
            at += nc;
            calls.push(called);
        }
        *cache = Some(MotionState {
            token,
            rows,
            routes,
            calls,
            blocks: nb,
            delta: crate::numbers::Map::default(),
            order: vec![],
        });
    }
    assert_eq!(at, v.len());
    let state = cache.as_mut().expect("simulation state not loaded");
    assert_eq!(state.token, token);
    assert_eq!(state.blocks, nb);
    let mut input = vec![0.0, now, spacing, nb as f64, state.rows.len() as f64];
    input.extend_from_slice(releases);
    for (i, row) in state.rows.iter_mut().enumerate() {
        let ix = if row[3] == 1.0 { row[2] } else { row[2] - 1.0 };
        let edge = if ix >= 0.0 {
            state.routes[i].get(ix as usize).copied()
        } else {
            None
        };
        row[17] = edge.map_or(0.0, |a| a.0);
        row[19] = edge.map_or(-1.0, |a| a.1);
        let next = row[2] + row[3];
        let reset = if row[3] == 1.0 { 0 } else { int(row[4]) };
        row[15] = if next >= 0.0 && state.calls[i].get(next as usize) == Some(&true) {
            1.0
        } else {
            0.0
        };
        row[16] = if state.calls[i].get(reset) == Some(&true) {
            1.0
        } else {
            0.0
        };
        input.extend_from_slice(row);
    }
    let out = motion(&input);
    for (row, result) in state.rows.iter_mut().zip(out.chunks_exact(8)) {
        match result[0] as u8 {
            1 => {
                row[1] = 3.0;
            }
            2 => {
                row[5] = result[1];
            }
            3 | 5 => {
                row[2] = result[4];
                row[8] = result[5];
                row[5] = 0.0;
                row[1] = if result[0] == 5.0 { 3.0 } else { 0.0 };
            }
            4 => {
                row[2] = result[6];
                row[8] = result[7];
                row[5] = 0.0;
                row[1] = 0.0;
            }
            6 => {
                row[1] = 2.0;
            }
            7 => {
                row[1] = 1.0;
                row[5] = 0.0;
                row[6] = now;
                row[7] = result[5];
            }
            _ => {}
        }
    }
    out
}

struct DeltaTrain {
    group: usize,
    row: [f64; 20],
    route: Vec<(f64, f64)>,
    calls: Vec<bool>,
}
pub(super) fn motion_packet(v: &[f64], cache: &mut Option<MotionState>) -> Vec<f64> {
    if v[0] == 6.0 {
        incremental(v, cache)
    } else {
        persistent(v, cache)
    }
}
fn incremental(v: &[f64], cache: &mut Option<MotionState>) -> Vec<f64> {
    let token = v[1];
    let now = v[2];
    let spacing = v[3];
    let reset = v[4] != 0.0;
    let nb = int(v[5]);
    let releases = &v[6..6 + nb];
    let mut at = 6 + nb;
    if reset {
        *cache = Some(MotionState {
            token,
            rows: vec![],
            routes: vec![],
            calls: vec![],
            blocks: nb,
            delta: crate::numbers::Map::default(),
            order: vec![],
        });
    }
    let s = cache.as_mut().expect("incremental motion missing");
    assert_eq!(s.token, token);
    s.blocks = nb;
    let norder = v[at];
    at += 1;
    if norder >= 0.0 {
        s.order = (0..int(norder))
            .map(|_| {
                let id = int(v[at]);
                at += 1;
                id
            })
            .collect();
    }
    let n = int(v[at]);
    at += 1;
    for _ in 0..n {
        let id = int(v[at]);
        let group = int(v[at + 1]);
        at += 2;
        let mut row = [0.0; 20];
        row.copy_from_slice(&v[at..at + 20]);
        at += 20;
        let nr = int(v[at]);
        at += 1;
        let mut route = vec![];
        for _ in 0..nr {
            route.push((v[at], v[at + 1]));
            at += 2;
        }
        let nc = int(v[at]);
        at += 1;
        let calls = v[at..at + nc].iter().map(|&x| x != 0.0).collect();
        at += nc;
        s.delta.insert(
            id,
            DeltaTrain {
                group,
                row,
                route,
                calls,
            },
        );
    }
    assert_eq!(at, v.len());
    if norder >= 0.0 {
        let alive = s.order.iter().copied().collect::<crate::numbers::Set<_>>();
        s.delta.retain(|id, _| alive.contains(id));
    }
    let mut counts = crate::numbers::Map::default();
    for id in &s.order {
        *counts.entry(s.delta[id].group).or_insert(0.0) += 1.0;
    }
    let mut input = vec![0.0, now, spacing, nb as f64, s.order.len() as f64];
    input.extend_from_slice(releases);
    for id in &s.order {
        let t = s.delta.get_mut(id).unwrap();
        let row = &mut t.row;
        row[13] = counts[&t.group];
        let ix = if row[3] == 1.0 { row[2] } else { row[2] - 1.0 };
        let edge = if ix >= 0.0 {
            t.route.get(ix as usize).copied()
        } else {
            None
        };
        row[17] = edge.map_or(0.0, |e| e.0);
        row[19] = edge.map_or(-1.0, |e| e.1);
        let next = row[2] + row[3];
        let reset = if row[3] == 1.0 { 0 } else { int(row[4]) };
        row[15] = if next >= 0.0 && t.calls.get(next as usize) == Some(&true) {
            1.0
        } else {
            0.0
        };
        row[16] = if t.calls.get(reset) == Some(&true) {
            1.0
        } else {
            0.0
        };
        input.extend_from_slice(row);
    }
    let out = motion(&input);
    for (id, r) in s.order.iter().zip(out.chunks_exact(8)) {
        let row = &mut s.delta.get_mut(id).unwrap().row;
        match r[0] as u8 {
            1 => row[1] = 3.0,
            2 => row[5] = r[1],
            3 | 5 => {
                row[2] = r[4];
                row[8] = r[5];
                row[5] = 0.0;
                row[1] = if r[0] == 5.0 { 3.0 } else { 0.0 };
            }
            4 => {
                row[2] = r[6];
                row[8] = r[7];
                row[5] = 0.0;
                row[1] = 0.0;
            }
            6 => row[1] = 2.0,
            7 => {
                row[1] = 1.0;
                row[5] = 0.0;
                row[6] = now;
                row[7] = r[5];
            }
            _ => {}
        }
    }
    out
}

pub(super) struct Sampling {
    token: f64,
    fi: Vec<usize>,
    pi: Vec<usize>,
    temporal: Option<TemporalSampling>,
}
fn cached_sample(v: &[f64], cache: &mut Option<Sampling>) -> Vec<f64> {
    let token = v[1];
    let load = v[2] != 0.0;
    let n = int(v[3]);
    let nf = int(v[4]);
    let np = int(v[5]);
    let base = 8 + nf + np + n;
    assert_eq!(v.len(), base + if load { n * 2 } else { 0 });
    if load {
        let mut fi = Vec::with_capacity(n);
        let mut pi = Vec::with_capacity(n);
        for pair in v[base..].chunks_exact(2) {
            let f = int(pair[0]);
            let p = int(pair[1]);
            assert!(f < nf && p < np);
            fi.push(f);
            pi.push(p);
        }
        *cache = Some(Sampling {
            token,
            fi,
            pi,
            temporal: None,
        });
    }
    let c = cache.as_ref().expect("sampling metadata missing");
    assert_eq!(c.token, token);
    assert_eq!(c.fi.len(), n);
    let fv = &v[8..8 + nf];
    let pv = &v[8 + nf..8 + nf + np];
    let daily = &v[8 + nf + np..base];
    let mut weights = Vec::with_capacity(n);
    let mut total = 0.0;
    for i in 0..n {
        let w = daily[i] * fv[c.fi[i]] * pv[c.pi[i]];
        assert!(w.is_finite() && w >= 0.0);
        weights.push(w);
        total += w;
    }
    sample_weights(&weights, total, v[6], v[7])
}

struct TemporalSampling {
    daily: Vec<f64>,
    factors: Vec<(bool, Vec<usize>)>,
    profiles: Vec<(usize, bool, usize)>,
}
fn timed_sample(v: &[f64], cache: &mut Option<Sampling>) -> Vec<f64> {
    let token = v[1];
    let load = v[2] != 0.0;
    let n = int(v[3]);
    let nf = int(v[4]);
    let np = int(v[5]);
    let integer = v[10] != 0.0;
    let model = v[11];
    let nl = int(v[12]);
    let delta = v[0] == 9.0;
    let daily_at = 13 + nl * 4;
    let base = daily_at + n;
    if load {
        let mut at = base;
        let mut factors = Vec::with_capacity(nf);
        let mut profiles = Vec::with_capacity(np);
        for _ in 0..nf {
            let hub = v[at] != 0.0;
            let len = int(v[at + 1]);
            at += 2;
            let ids = v[at..at + len]
                .iter()
                .map(|&x| {
                    let id = int(x);
                    assert!(id < nl);
                    id
                })
                .collect();
            at += len;
            factors.push((hub, ids));
        }
        for _ in 0..np {
            profiles.push((int(v[at]), v[at + 1] != 0.0, int(v[at + 2])));
            at += 3;
        }
        assert_eq!(v.len(), at + n * 2);
        let mut fi = Vec::with_capacity(n);
        let mut pi = Vec::with_capacity(n);
        for pair in v[at..].chunks_exact(2) {
            let f = int(pair[0]);
            let p = int(pair[1]);
            assert!(f < nf && p < np);
            fi.push(f);
            pi.push(p);
        }
        *cache = Some(Sampling {
            token,
            fi,
            pi,
            temporal: Some(TemporalSampling {
                factors,
                profiles,
                daily: if delta {
                    v[daily_at..base].to_vec()
                } else {
                    vec![]
                },
            }),
        });
    } else if delta {
        let count = int(v[daily_at]);
        assert_eq!(v.len(), daily_at + 1 + count * 2);
        let c = cache.as_mut().expect("temporal sampling metadata missing");
        assert_eq!(c.token, token);
        let daily = &mut c
            .temporal
            .as_mut()
            .expect("incorrect sampling protocol")
            .daily;
        assert_eq!(daily.len(), n);
        for pair in v[daily_at + 1..].chunks_exact(2) {
            daily[int(pair[0])] = pair[1];
        }
    } else {
        assert_eq!(v.len(), base);
    }
    let c = cache.as_ref().expect("temporal sampling metadata missing");
    assert_eq!(c.token, token);
    assert_eq!(c.fi.len(), n);
    let meta = c.temporal.as_ref().expect("incorrect sampling protocol");
    assert_eq!(meta.factors.len(), nf);
    assert_eq!(meta.profiles.len(), np);
    let line_rows = &v[13..13 + nl * 4];
    let factors = meta
        .factors
        .iter()
        .map(|(hub, ids)| {
            if model == 0.0 {
                return 1.0;
            }
            ids.iter().fold(f64::INFINITY, |value, &id| {
                let r = &line_rows[id * 4..id * 4 + 4];
                let factor = if r[0] == 0.0 {
                    1.0
                } else if model == 22.0 {
                    0.25 + 0.75 * max(0.0, min(1.0, r[1]))
                } else {
                    let awareness = if *hub { 1.0 - (1.0 - r[2]) * 0.5 } else { r[2] };
                    max(0.0, min(1.0, awareness * r[3]))
                };
                min(value, factor)
            })
        })
        .collect::<Vec<_>>();
    let profiles = meta
        .profiles
        .iter()
        .map(|&(p, back, ext)| crate::temporal::profile(p, back, v[8], ext) * v[9])
        .collect::<Vec<_>>();
    let daily = if delta {
        &meta.daily[..]
    } else {
        &v[daily_at..base]
    };
    let mut total = 0.0;
    let mut weights = Vec::with_capacity(n);
    if integer {
        for i in 0..n {
            let f = if meta.factors[c.fi[i]].1.is_empty() {
                1.0
            } else {
                factors[c.fi[i]]
            };
            let w = daily[i] * f * profiles[c.pi[i]];
            assert!(w.is_finite() && w >= 0.0);
            weights.push(w);
            total += w;
        }
        sample_weights(&weights, total, v[6], v[7])
    } else {
        let mut out = vec![0.0, v[6], v[7], 0.0];
        for i in 0..n {
            let amount = daily[i] * profiles[c.pi[i]];
            if amount >= 1e-12 {
                out.extend_from_slice(&[i as f64, amount]);
            }
        }
        out[3] = ((out.len() - 4) / 2) as f64;
        out
    }
}
