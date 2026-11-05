//! Demand kernels share the routing instance's binary scratch boundary.
//! Browser math primitives preserve the established JS exp/log/hypot rounding;
//! all model decisions, iterations and aggregation loops execute in Rust.
use crate::{int, CORE};
use std::collections::HashMap;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "rail_math")]
extern "C" {
    #[link_name = "exp"]
    fn host_exp(value: f64) -> f64;
    #[link_name = "log"]
    fn host_log(value: f64) -> f64;
    #[link_name = "hypot"]
    fn host_hypot(x: f64, y: f64) -> f64;
}
fn exp(value: f64) -> f64 {
    let value = if value.is_nan() {
        value
    } else {
        value.clamp(-700.0, 700.0)
    };
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { host_exp(value) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        value.exp()
    }
}
fn log(value: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { host_log(value) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        value.ln()
    }
}
fn hypot(x: f64, y: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { host_hypot(x, y) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        x.hypot(y)
    }
}
fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}
fn min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}
fn fit(
    matrix: &mut [f64],
    rows: &[f64],
    cols: &[f64],
    n: usize,
    limit: usize,
    tolerance: f64,
) -> (f64, usize) {
    let mut error = f64::INFINITY;
    let mut iterations = 0;
    while iterations < limit {
        for i in 0..n {
            let mut sum = 0.0;
            for j in 0..n {
                sum += matrix[i * n + j];
            }
            let factor = if sum != 0.0 { rows[i] / sum } else { 0.0 };
            for j in 0..n {
                matrix[i * n + j] *= factor;
            }
        }
        for j in 0..n {
            let mut sum = 0.0;
            for i in 0..n {
                sum += matrix[i * n + j];
            }
            let factor = if sum != 0.0 { cols[j] / sum } else { 0.0 };
            for i in 0..n {
                matrix[i * n + j] *= factor;
            }
        }
        error = 0.0;
        for i in 0..n {
            let mut sum = 0.0;
            for j in 0..n {
                sum += matrix[i * n + j];
            }
            error = max(error, (sum - rows[i]).abs() / max(1.0, rows[i]));
        }
        if error < tolerance {
            break;
        }
        iterations += 1;
    }
    (error, iterations + 1)
}
fn ipf(input: &[f64]) -> Vec<f64> {
    assert!(input.len() >= 3);
    let (n, limit, tolerance) = (int(input[0]), int(input[1]), input[2]);
    assert_eq!(input.len(), 3 + n * n + n * 2);
    let mut matrix = input[3..3 + n * n].to_vec();
    let rows = &input[3 + n * n..3 + n * n + n];
    let cols = &input[3 + n * n + n..];
    let (error, iterations) = fit(&mut matrix, rows, cols, n, limit, tolerance);
    let mut out = vec![error, iterations as f64];
    out.extend(matrix);
    out
}
fn distribution(input: &[f64]) -> Vec<f64> {
    assert!(input.len() >= 6);
    let n = int(input[0]);
    let effective = input[1] != 0.0;
    let population = input[2];
    assert_eq!(input.len(), 6 + n * 8);
    let zone = |i: usize, field: usize| input[6 + i * 8 + field];
    let mut out = vec![0.0; 5];
    for (p, (field, decay)) in [(4, 14.0), (5, 5.0), (7, 10.0)].into_iter().enumerate() {
        let total = input[3 + p];
        let mut attraction = 0.0;
        for i in 0..n {
            attraction += zone(i, field);
        }
        let rows: Vec<f64> = (0..n)
            .map(|i| {
                if population != 0.0 {
                    zone(i, 3) / population * total
                } else {
                    0.0
                }
            })
            .collect();
        let cols: Vec<f64> = (0..n)
            .map(|i| {
                if attraction != 0.0 {
                    total * zone(i, field) / attraction
                } else {
                    0.0
                }
            })
            .collect();
        let mut matrix = vec![0.0; n * n];
        for i in 0..n {
            let mut sum = 0.0;
            for j in 0..n {
                let km = if i == j {
                    zone(i, 2).sqrt() * 0.45
                } else {
                    hypot(zone(i, 0) - zone(j, 0), zone(i, 1) - zone(j, 1)) * 0.045
                };
                matrix[i * n + j] = zone(j, field) * exp(-km / decay);
                sum += matrix[i * n + j];
            }
            for j in 0..n {
                matrix[i * n + j] *= if sum != 0.0 { rows[i] / sum } else { 0.0 };
            }
        }
        if p == 0 || effective {
            let (error, iterations) = fit(
                &mut matrix,
                &rows,
                &cols,
                n,
                if effective {
                    if p == 0 {
                        64
                    } else {
                        24
                    }
                } else {
                    160
                },
                if effective { 1e-5 } else { 1e-6 },
            );
            if p == 0 {
                out[0] = error;
                out[1] = iterations as f64;
            }
            if effective {
                for i in 0..n {
                    let mut sum = 0.0;
                    for j in 0..n {
                        sum += matrix[i * n + j];
                    }
                    if sum > rows[i] && sum > 0.0 {
                        let ratio = rows[i] / sum;
                        for j in 0..n {
                            matrix[i * n + j] *= ratio;
                        }
                    }
                }
            }
        }
        out[2 + p] = matrix.iter().fold(0.0, |sum, v| sum + v);
        out.extend(matrix);
    }
    out
}
fn logsum(values: &[f64]) -> f64 {
    let highest = values.iter().fold(f64::NEG_INFINITY, |a, b| max(a, *b));
    if highest.is_finite() {
        highest + log(values.iter().fold(0.0, |sum, v| sum + exp(v - highest)))
    } else {
        f64::NEG_INFINITY
    }
}
fn mode_value(input: &[f64]) -> f64 {
    assert_eq!(input.len(), 10);
    let (value, minutes, access_cost, price, km) =
        (input[0], input[1], input[2], input[3], input[4]);
    let active = [
        (km * 1.25 / 4.8 * 60.0, input[5]),
        (3.0 + km * 1.25 / 13.0 * 60.0, input[6]),
    ];
    let motor = [
        (
            8.0 + km / 23.0 * 60.0 * 1.22 + (120.0 + km * 18.0) / value,
            input[7],
        ),
        (
            8.0 + 6.0 + km / 16.0 * 60.0 * 1.35 + if km > 6.0 { 8.0 } else { 0.0 } + 70.0 / value,
            input[8],
        ),
        (minutes + access_cost + price / value, input[9]),
    ];
    let utility = |cost: f64, p: f64| {
        if p > 0.0 {
            -0.055 * cost / 0.7 + log(p)
        } else {
            f64::NEG_INFINITY
        }
    };
    let a = active.map(|(cost, p)| utility(cost, p));
    let m = motor.map(|(cost, p)| utility(cost, p));
    let la = logsum(&a);
    let lm = logsum(&m);
    let top = logsum(&[0.7 * la, 0.7 * lm]);
    if m[2].is_finite() {
        exp(0.7 * lm - top + m[2] - lm)
    } else {
        0.0
    }
}
fn mode(input: &[f64]) -> Vec<f64> {
    vec![mode_value(input)]
}
#[no_mangle]
pub extern "C" fn demand_mode_scalar(
    value: f64,
    minutes: f64,
    access_cost: f64,
    price: f64,
    km: f64,
    walk: f64,
    bike: f64,
    car: f64,
    bus: f64,
    rail: f64,
) -> f64 {
    mode_value(&[
        value,
        minutes,
        access_cost,
        price,
        km,
        walk,
        bike,
        car,
        bus,
        rail,
    ])
}
#[derive(Clone)]
struct OptionRow {
    index: f64,
    cost: f64,
    freq: f64,
}
fn strategy(input: &[f64]) -> Vec<f64> {
    assert!(input.len() >= 2);
    let n = int(input[0]);
    let value = input[1];
    assert_eq!(input.len(), 2 + n * 5);
    let mut unique: Vec<OptionRow> = vec![];
    let mut keys: HashMap<usize, usize> = HashMap::new();
    for i in 0..n {
        let at = 2 + i * 5;
        let key = int(input[at]);
        let row = OptionRow {
            index: input[at + 4],
            cost: input[at + 1] - input[at + 3] / 2.0 + input[at + 2] / value,
            freq: 1.0 / input[at + 3],
        };
        if let Some(&index) = keys.get(&key) {
            if row.cost < unique[index].cost {
                unique[index] = row;
            }
        } else {
            keys.insert(key, unique.len());
            unique.push(row);
        }
    }
    unique.sort_by(|a, b| {
        a.cost
            .partial_cmp(&b.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let (mut frequency, mut weighted, mut expected) = (0.0, 0.5, f64::INFINITY);
    let mut accepted = vec![];
    for row in unique {
        if row.cost >= expected {
            continue;
        }
        frequency += row.freq;
        weighted += row.freq * row.cost;
        expected = weighted / frequency;
        accepted.push(row);
    }
    let mut out = vec![
        expected,
        if frequency != 0.0 {
            0.5 / frequency
        } else {
            0.0
        },
        accepted.len() as f64,
    ];
    for row in accepted {
        out.extend_from_slice(&[row.index, row.cost, row.freq, row.freq / frequency]);
    }
    out
}
fn capacity(input: &[f64]) -> Vec<f64> {
    assert!(input.len() >= 4);
    let (nt, nf, nl, nr) = (int(input[0]), int(input[1]), int(input[2]), int(input[3]));
    let mut at = 4;
    let mut runs = Vec::with_capacity(nr);
    for _ in 0..nr {
        let (headway, capacity, count) = (input[at], input[at + 1], int(input[at + 2]));
        at += 3;
        let mut tracks = Vec::with_capacity(count);
        for _ in 0..count {
            let id = int(input[at]);
            assert!(id < nt);
            tracks.push(id);
            at += 1;
        }
        runs.push((headway, capacity, tracks));
    }
    let mut track_cap = vec![0.0; nt];
    for (id, capacity) in track_cap.iter_mut().enumerate() {
        for (headway, seats, tracks) in &runs {
            if tracks.contains(&id) {
                *capacity += 60.0 / headway * seats;
            }
        }
    }
    let mut track_flow = vec![0.0; nt];
    let mut used = vec![false; nt];
    let mut flows = Vec::with_capacity(nf);
    for _ in 0..nf {
        let demand = input[at];
        let count = int(input[at + 1]);
        at += 2;
        let mut tracks = Vec::with_capacity(count);
        for _ in 0..count {
            let id = int(input[at]);
            assert!(id < nt);
            tracks.push(id);
            track_flow[id] += demand;
            used[id] = true;
            at += 1;
        }
        let count = int(input[at]);
        at += 1;
        let mut lines = Vec::with_capacity(count);
        for _ in 0..count {
            let id = int(input[at]);
            assert!(id < nl);
            lines.push(id);
            at += 1;
        }
        flows.push((demand, tracks, lines));
    }
    assert_eq!(input.len(), at);
    let loads: Vec<f64> = track_flow
        .iter()
        .zip(&track_cap)
        .map(|(flow, cap)| flow * 0.18 / max(1.0, *cap))
        .collect();
    let mut line_flow = vec![0.0; nl];
    let mut line_used = vec![false; nl];
    let mut served = Vec::with_capacity(nf);
    let (mut riders, mut unserved) = (0.0, 0.0);
    for (demand, tracks, lines) in flows {
        let ratio = tracks
            .iter()
            .fold(1.0, |ratio, id| min(ratio, 1.0 / max(1.0, loads[*id])));
        let trips = demand * ratio;
        served.push(trips);
        riders += trips;
        unserved += demand - trips;
        for line in lines {
            line_flow[line] += trips;
            line_used[line] = true;
        }
    }
    let mut out = vec![riders, unserved];
    for id in 0..nt {
        out.extend_from_slice(&[if used[id] { 1.0 } else { 0.0 }, track_flow[id], loads[id]]);
    }
    out.extend(served);
    for id in 0..nl {
        out.extend_from_slice(&[if line_used[id] { 1.0 } else { 0.0 }, line_flow[id]]);
    }
    out
}
fn run(kernel: fn(&[f64]) -> Vec<f64>) -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        c.output = Vec::new();
        c.output = kernel(&c.input);
        c.output.as_ptr()
    })
}
#[no_mangle]
pub extern "C" fn demand_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn demand_ipf() -> *const f64 {
    run(ipf)
}
#[no_mangle]
pub extern "C" fn demand_distribution() -> *const f64 {
    run(distribution)
}
#[no_mangle]
pub extern "C" fn demand_mode() -> *const f64 {
    run(mode)
}
#[no_mangle]
pub extern "C" fn demand_strategy() -> *const f64 {
    run(strategy)
}
#[no_mangle]
pub extern "C" fn demand_capacity() -> *const f64 {
    run(capacity)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ipf_margins() {
        let out = ipf(&[2.0, 160.0, 1e-6, 1.0, 2.0, 3.0, 4.0, 30.0, 70.0, 40.0, 60.0]);
        assert!(out[0] < 1e-6);
        assert!((out[2] + out[4] - 40.0).abs() < 1e-8);
    }
    #[test]
    fn disabled_rail() {
        assert_eq!(
            mode(&[40.0, 12.0, 5.0, 180.0, 8.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
            vec![0.0]
        );
    }
}
