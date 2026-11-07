//! Feedback, operating accounts and the shared interval clock.
//! Host adapters provide service metadata; all scoring, decay, debt and clock decisions are native.
use crate::{
    demand::{hypot, raw_exp},
    CORE,
};
struct Reader<'a> {
    a: &'a [f64],
    p: usize,
}
impl Reader<'_> {
    fn f(&mut self) -> f64 {
        let v = self.a[self.p];
        self.p += 1;
        v
    }
    fn n(&mut self) -> usize {
        self.f() as usize
    }
    fn row(&mut self, n: usize) -> Vec<f64> {
        (0..n).map(|_| self.f()).collect()
    }
}
fn clamp(x: f64, a: f64, b: f64) -> f64 {
    if x.is_nan() {
        x
    } else {
        x.max(a).min(b)
    }
}
fn truth(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}
#[derive(Clone)]
struct Line {
    open: f64,
    close: f64,
    active: bool,
    connect: bool,
    km: f64,
    direct: f64,
    fare: f64,
    base: f64,
    stops: Vec<usize>,
    v: Vec<f64>,
}
fn feedback(r: &mut Reader<'_>) -> Vec<f64> {
    let now = r.f();
    let minutes = r.f();
    let step = r.f() != 0.0;
    let modern = r.f() != 0.0;
    let nodes = (0..r.n()).map(|_| (r.f(), r.f())).collect::<Vec<_>>();
    let facilities = (0..r.n())
        .map(|_| (r.f(), r.f(), r.f()))
        .collect::<Vec<_>>();
    let mut lines = Vec::new();
    for _ in 0..r.n() {
        let open = r.f();
        let close = r.f();
        let active = r.f() != 0.0;
        let connect = r.f() != 0.0;
        let km = r.f();
        let direct = r.f();
        let fare = r.f();
        let base = r.f();
        let stops = (0..r.n()).map(|_| r.n()).collect();
        let v = r.row(10);
        lines.push(Line {
            open,
            close,
            active,
            connect,
            km,
            direct,
            fare,
            base,
            stops,
            v,
        });
    }
    let mut runs = vec![Vec::<(f64, f64)>::new(); lines.len()];
    for _ in 0..r.n() {
        let i = r.n();
        let h = r.f();
        let d = r.f();
        if i < runs.len() {
            runs[i].push((h, d));
        }
    }
    let mut loads = vec![Vec::<f64>::new(); lines.len()];
    for _ in 0..r.n() {
        let i = r.n();
        let n = r.f();
        let cap = r.f();
        if i < loads.len() {
            loads[i].push(n / cap.max(1.0));
        }
    }
    let mut out = vec![1.0, lines.len() as f64];
    let m = ((now % 1440.0) + 1440.0) % 1440.0;
    for (i, l) in lines.iter().enumerate() {
        let mut v = l.v.clone(); // serviceDays, awareness, trust, attempted, lost, wait, boarded, satisfaction, priorMinute, priorNull
        let open = !(m < l.open || m >= l.close);
        if step && open {
            let delta = minutes / (l.close - l.open).max(60.0);
            if l.active {
                v[0] += delta;
                v[1] = 1.0 - (1.0 - v[1]) * raw_exp(-delta / 10.0);
            }
            let loss = if truth(v[3]) {
                clamp(v[4] / v[3], 0.0, 1.0)
            } else {
                0.0
            };
            let wait = if truth(v[6]) { v[5] / v[6] } else { 0.0 };
            let target = if l.active {
                clamp(1.0 - 0.8 * loss - (wait - 10.0).max(0.0) / 75.0, 0.3, 1.0)
            } else {
                0.35
            };
            v[2] += (target - v[2]) * (1.0 - raw_exp(-delta / 2.0));
            let fade = raw_exp(-delta);
            for k in 3..7 {
                v[k] *= fade;
            }
        }
        let update = modern && !(truth(minutes) && !open);
        out.extend_from_slice(&v[..7]);
        out.push(if update { 1.0 } else { 0.0 });
        if !update {
            continue;
        }
        let freq = runs[i].iter().fold(0.0, |s, x| s + 1.0 / x.0);
        let headway = if truth(freq) {
            1.0 / freq
        } else {
            f64::INFINITY
        };
        let duration = runs[i]
            .iter()
            .fold(0.0, |s, x| s + x.1 / runs[i].len().max(1) as f64);
        let speed = if truth(duration) {
            l.km / duration * 60.0
        } else {
            0.0
        };
        let load = if loads[i].is_empty() {
            0.0
        } else {
            loads[i].iter().fold(0.0, |a, b| a + b) / loads[i].len() as f64
        };
        let loss = if truth(v[3]) {
            clamp(v[4] / v[3], 0.0, 1.0)
        } else {
            0.0
        };
        let wait = (if truth(v[6]) { v[5] / v[6] } else { 0.0 }).max(if headway.is_finite() {
            headway / 2.0
        } else {
            45.0
        });
        let mut reached = vec![false; nodes.len()];
        for &id in &l.stops {
            reached[id] = true;
        }
        loop {
            let mut changed = false;
            for other in &lines {
                if other.connect && other.stops.iter().any(|&id| reached[id]) {
                    for &id in &other.stops {
                        if !reached[id] {
                            reached[id] = true;
                            changed = true;
                        }
                    }
                }
            }
            if !changed {
                break;
            }
        }
        let distance =
            |id: usize, f: &(f64, f64, f64)| hypot(nodes[id].0 - f.0, nodes[id].1 - f.1) * 0.045;
        let mut total = 0.0;
        let mut covered = 0.0;
        for f in &facilities {
            if l.stops.iter().any(|&id| distance(id, f) <= 3.0) {
                total += f.2;
                if reached
                    .iter()
                    .enumerate()
                    .any(|(id, &yes)| yes && distance(id, f) * 1.25 <= 0.8)
                {
                    covered += f.2;
                }
            }
        }
        let scores = [
            clamp(1.0 - (load - 0.55).max(0.0) / 0.6 - loss * 0.65, 0.0, 1.0),
            clamp(1.0 - (wait - 2.0).max(0.0) / 18.0, 0.0, 1.0),
            clamp(
                (speed / 38.0) * (0.35 + 0.65 * (l.direct / l.km.max(0.1)).min(1.0)),
                0.0,
                1.0,
            ),
            if truth(total) {
                clamp(covered / total, 0.0, 1.0)
            } else {
                0.6
            },
            clamp(1.0 - (l.fare / l.base - 0.8).max(0.0) / 1.8, 0.0, 1.0),
            clamp((if truth(freq) { 1.0 } else { 0.0 }) - loss, 0.0, 1.0),
            clamp((l.close - l.open) / 1080.0, 0.0, 1.0),
        ];
        let weights = [0.22, 0.18, 0.15, 0.15, 0.13, 0.10, 0.07];
        let score = scores.iter().zip(weights).fold(0.0, |s, (v, w)| s + v * w);
        let alpha = if v[9] != 0.0 {
            1.0
        } else {
            1.0 - raw_exp(-minutes / 90.0)
        };
        let satisfaction = clamp(v[7] + (score - v[7]) * alpha, 0.0, 1.0);
        out.extend_from_slice(&scores);
        out.extend_from_slice(&[
            score,
            headway,
            load,
            wait,
            loss,
            speed,
            covered,
            total,
            satisfaction,
        ]);
    }
    out
}
const FIELDS: usize = 9;
// cash, revenue, operatingGrant, operating, interestPaid, principalPaid, arrears, minute, blocked
fn settle(e: &mut [f64], loans: &mut Vec<Vec<f64>>, payments: &mut Vec<f64>) {
    e[8] = 0.0;
    if e[6] > 0.0 {
        let paid = e[0].min(e[6]);
        e[0] -= paid;
        e[6] -= paid;
        if e[6] > 0.001 {
            e[8] = 1.0;
        } else {
            e[6] = 0.0;
        }
    }
    for l in loans.iter_mut() {
        // original index, principal, interest, installment, nextDue
        while l[1] > 0.001 && e[7] + 1e-5 >= l[4] {
            let principal = l[1].min(l[3]);
            let bill = principal + l[2];
            if e[0] + 0.001 < bill {
                e[8] = 1.0;
                break;
            }
            e[0] = (e[0] - bill).max(0.0);
            e[4] += l[2];
            e[5] += principal;
            l[1] -= principal;
            l[2] = 0.0;
            l[4] += 1440.0;
            payments.push(bill);
        }
    }
    loans.retain(|l| l[1] > 0.001);
    if e[0] <= 0.001 {
        e[8] = 1.0;
    }
}
fn next(now: f64, left: f64, loans: &[Vec<f64>]) -> f64 {
    if left <= 1e-9 {
        return 0.0;
    }
    let mut dt = left.min(0.1);
    let due = loans.iter().fold(f64::INFINITY, |d, l| d.min(l[4]));
    if due > now && due < now + dt {
        dt = due - now;
    }
    dt
}
// Minute gate and residual share the operating/loan step clock.
fn generation(carry: f64, dt: f64) -> (f64, f64) {
    if dt <= 1e-9 {
        return (carry, 0.0);
    }
    let carry = carry + dt;
    if carry < 1.0 - 1e-9 {
        (carry, 0.0)
    } else {
        let interval = (carry + 1e-9).floor();
        (carry - interval, interval)
    }
}
fn accounts(r: &mut Reader<'_>, op: usize) -> Vec<f64> {
    let now = r.f();
    let mut left = r.f();
    let dt = r.f();
    let earned = r.f();
    let vehicle = r.f();
    let track = r.f();
    let upkeep = r.f();
    let active = r.f();
    let owned = r.f();
    let factor = r.f();
    let grant_rate = r.f();
    let carry = r.f();
    let mut e = r.row(FIELDS);
    let mut loans = Vec::new();
    for i in 0..r.n() {
        let mut l = vec![i as f64];
        l.extend(r.row(4));
        loans.push(l);
    }
    let mut credit_error = 0.0;
    let available = if loans.len() >= 3 {
        0.0
    } else {
        (3e9 - loans.iter().fold(0.0, |v, l| v + l[1]))
            .min(1e9)
            .max(0.0)
    };
    let mut command_amount = 0.0;
    let mut next_id = earned;
    if op == 6 {
        match vehicle as usize {
            1 => {
                if !left.is_finite() || left < 1e8 || left > available + 0.01 {
                    credit_error = 1.0;
                } else {
                    e[0] += left;
                    loans.push(vec![-1.0, left, 0.0, left / 30.0, e[7] + 1440.0]);
                    command_amount = left;
                    next_id += 1.0;
                }
            }
            2 => {
                if dt < 0.0 || dt as usize >= loans.len() {
                    credit_error = 2.0;
                } else {
                    let l = &loans[dt as usize];
                    let bill = l[1] + l[2];
                    if e[0] + 0.01 < bill {
                        credit_error = 3.0;
                    } else {
                        e[0] -= bill;
                        e[5] += l[1];
                        e[4] += l[2];
                        command_amount = -bill;
                        loans.remove(dt as usize);
                    }
                }
            }
            _ => {}
        }
    }
    let mut cost = 0.0;
    let mut fixed_cost = 0.0;
    let mut payments = Vec::new();
    if op == 2 {
        let fixed = track + upkeep + active * 18000.0 + (owned - active).max(0.0) * 2700.0;
        cost = (vehicle + fixed * dt / 1440.0) * factor;
        fixed_cost = fixed * dt / 1440.0 * factor;
        let grant = earned * grant_rate;
        e[1] += earned;
        e[2] += grant;
        e[3] += cost;
        e[0] += earned + grant - cost;
        if e[0] < 0.0 {
            e[6] -= e[0];
            e[0] = 0.0;
        }
        for l in &mut loans {
            l[2] += l[1] * 0.0005 * dt / 1440.0;
        }
        e[7] = now;
        left -= dt;
    }
    if (op == 6 && credit_error == 0.0 && vehicle != 0.0) || (op != 6 && (op != 3 || e[8] != 0.0)) {
        settle(&mut e, &mut loans, &mut payments);
    }
    let dt_next = if e[8] != 0.0 {
        0.0
    } else {
        next(now, left, &loans)
    };
    // Keep skipped sub-epsilon passenger steps identical to the established runtime.
    let target = if dt_next > 1e-9 { now + dt_next } else { now };
    let (carry_next, interval) = generation(carry, dt_next);
    let mut out = vec![
        1.0, dt_next, left, target, cost, fixed_cost, carry_next, interval,
    ];
    out.extend(e);
    out.push(loans.len() as f64);
    for l in loans {
        out.extend(l);
    }
    out.push(payments.len() as f64);
    out.extend(payments);
    let n = r.n();
    if n > 0 {
        let current = r.f();
        out.push(n as f64);
        out.push((if truth(current) { current } else { 0.0 }) + cost);
        for _ in 1..n {
            let previous = r.f();
            let weight = r.f();
            out.push((if truth(previous) { previous } else { 0.0 }) + fixed_cost * weight);
        }
    } else {
        out.push(0.0);
    }

    out.extend_from_slice(&[credit_error, available, command_amount, next_id]);
    out
}
fn clock(r: &mut Reader<'_>) -> Vec<f64> {
    let mut now = r.f();
    let mut left = r.f();
    let mut carry = r.f();
    let mut out = vec![1.0];
    while left > 1e-9 {
        let dt = left.min(0.1);
        now += dt;
        let (next, interval) = generation(carry, dt);
        carry = next;
        out.extend_from_slice(&[dt, now, carry, interval]);
        left -= dt;
    }
    out
}

fn allocation(r: &mut Reader<'_>) -> Vec<f64> {
    let cost = r.f();
    let fixed = r.f();
    let current = r.f();
    let mut out = vec![1.0, if truth(current) { current } else { 0.0 } + cost];
    for _ in 0..r.n() {
        let previous = r.f();
        let weight = r.f();
        out.push((if truth(previous) { previous } else { 0.0 }) + fixed * weight);
    }
    out
}
fn run(input: &[f64]) -> Vec<f64> {
    let mut r = Reader { a: input, p: 0 };
    assert_eq!(r.f(), 1.0);
    let op = r.n();
    let out = match op {
        0 => feedback(&mut r),
        1..=3 | 6 => accounts(&mut r, op),
        4 => clock(&mut r),
        5 => allocation(&mut r),
        _ => panic!("unknown operations command"),
    };
    assert_eq!(r.p, input.len());
    out
}
#[no_mangle]
pub extern "C" fn operations_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn operations_run() -> *const f64 {
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
    fn clock_preserves_fractional_residual() {
        let out = run(&[1.0, 4.0, 420.0, 0.25, 0.8]);
        assert_eq!((out[1], out[2], out[4]), (0.1, 420.1, 0.0));
        assert_eq!((out[5], out[6], out[8]), (0.1, 420.20000000000005, 1.0));
        assert_eq!(out[9], 0.04999999999999999);
        assert_eq!(out[10], 420.25000000000006);
    }

    #[test]
    fn debt_blocks_at_due() {
        let mut e = vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1860.0, 0.0];
        let mut l = vec![vec![0.0, 100.0, 2.0, 10.0, 1860.0]];
        let mut p = vec![];
        settle(&mut e, &mut l, &mut p);
        assert_eq!(e[8], 1.0);
        assert_eq!(l[0][1], 100.0);
        assert!(p.is_empty());
    }
}
