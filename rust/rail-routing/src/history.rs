//! Cold history/record rules; numeric decisions are separate from JSON/UI object projection.
use crate::numbers::Set;
use crate::{queues::Read, CORE};

fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_negative() && b.is_sign_negative() {
            -0.0
        } else {
            0.0
        }
    } else if a > b {
        a
    } else {
        b
    }
}

pub(super) fn day(minute: f64) -> f64 {
    max(1.0, ((minute - 420.0 + 1e-7) / 1440.0).floor() + 1.0)
}
fn start(day: f64) -> f64 {
    420.0 + (day - 1.0) * 1440.0
}
fn zero(value: f64) -> f64 {
    if value.is_nan() || value == 0.0 {
        0.0
    } else {
        value
    }
}
fn bit(value: bool) -> f64 {
    if value {
        1.0
    } else {
        0.0
    }
}

fn run(input: &[f64]) -> Vec<f64> {
    let mut r = Read { v: input, at: 0 };
    assert_eq!(r.f(), 1.0);
    let op = r.u();
    let mut out = vec![];
    match op {
        0 => {
            let minute = r.f();
            let previous = r.f();
            let has_flow = r.f() != 0.0;
            let through = r.f();
            let history = r.u();
            let number = day(minute);
            let boundary = start(number);
            let archive = previous != number;
            let adjacent = previous == number - 1.0;
            out.extend([
                number,
                boundary,
                bit(archive),
                bit(archive && has_flow && adjacent),
                bit(archive && has_flow && adjacent && through >= boundary - 1.0),
                if archive {
                    history.saturating_add(1).saturating_sub(30) as f64
                } else {
                    0.0
                },
            ]);
            let n = r.u();
            for _ in 0..n {
                out.push(r.f() * r.f());
            }
        }
        1 => {
            let n = r.u();
            for k in 0..n {
                let a = r.f();
                let b = r.f();
                out.push(bit(k < 3 || a.is_finite() || b.is_finite()));
                out.push(max(
                    if a.is_finite() { a } else { 0.0 },
                    if b.is_finite() { b } else { 0.0 },
                ));
            }
        }
        2 => {
            let n = r.u();
            let tracks = (0..n).map(|_| r.f()).collect::<Vec<_>>();
            let mut used = Set::default();
            let mut order = vec![];
            let mut lengths = vec![];
            let mut longest = 0.0;
            let n = r.u();
            for _ in 0..n {
                let final_value = r.f() != 0.0;
                let mut sum = 0.0;
                for _ in 0..r.u() {
                    let id = r.u();
                    let value = tracks.get(id).copied().unwrap_or(0.0);
                    sum += zero(value);
                    if used.insert(id) {
                        order.push(id);
                    }
                }
                lengths.push(sum);
                if final_value {
                    longest = max(longest, sum);
                }
            }
            let network = order.iter().fold(0.0, |sum, &id| {
                sum + zero(tracks.get(id).copied().unwrap_or(0.0))
            });
            out.extend([network, longest]);
            out.extend(lengths);
        }
        3 => {
            let number = r.f();
            let valid = r.f() != 0.0;
            let width = r.f();
            assert!(width == 15.0 || width == 30.0 || width == 60.0);
            let since = r.f();
            let through = r.f();
            let bins = (0..96).map(|_| r.f()).collect::<Vec<_>>();
            let base = start(number);
            let n = (1440.0 / width) as usize;
            let mut rows = Vec::with_capacity(n * 5);
            let mut total = 0.0;
            let mut peak = None;
            let mut peak_value = 0.0;
            for i in 0..n {
                let a = base + (i as f64) * width;
                let b = a + width;
                let known = valid && a <= through && b > since;
                let mut value = 0.0;
                if known {
                    let from = i * (width as usize / 15);
                    let to = (i + 1) * (width as usize / 15);
                    for &v in &bins[from..to] {
                        value += zero(v);
                    }
                    total += value;
                    if peak.is_none() || value > peak_value {
                        peak = Some(i);
                        peak_value = value;
                    }
                }
                rows.extend([
                    a,
                    b,
                    bit(known),
                    value,
                    bit(known && (a < since || b > through)),
                ]);
            }
            out.extend([
                total,
                peak.map_or(-1.0, |i| i as f64),
                bit(valid),
                since,
                through,
                bit(!valid || since > base),
                n as f64,
            ]);
            out.extend(rows);
        }
        4 => {
            let n = r.u();
            for _ in 0..n {
                let value = r.f();
                let target = r.f();
                let income = r.f() != 0.0;
                let ratio = zero(value) / target;
                out.extend([
                    if income { target * 0.05 } else { target },
                    if income { value * 0.05 } else { value },
                    bit(value + 1e-7 >= target),
                    if ratio.is_nan() {
                        f64::NAN
                    } else if ratio < 1.0 {
                        ratio
                    } else {
                        1.0
                    },
                ]);
            }
        }
        5 => {let value=crate::value::read(&mut r);out=crate::value::write(&crate::daily::query(&value));}
        _ => panic!("unknown history operation"),
    }
    assert_eq!(r.at, input.len());
    out
}
#[no_mangle]
pub extern "C" fn history_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn history_run() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        c.output = run(&c.input);
        c.output.as_ptr()
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_boundaries_and_history_cap() {
        assert_eq!(day(1859.99999999), 2.0);
        let v = run(&[1.0, 0.0, 1860.0, 1.0, 1.0, 1859.0, 30.0, 1.0, 0.3, 0.7]);
        assert_eq!(&v[..6], &[2.0, 1860.0, 1.0, 1.0, 1.0, 1.0]);
        assert_eq!(v[6], 0.3 * 0.7);
        let v = run(&[1.0, 0.0, 3300.0, 1.0, 1.0, 1859.0, 30.0, 0.0]);
        assert_eq!(&v[3..5], &[0.0, 0.0]);
    }
    #[test]
    fn missing_records_stay_optional_and_negative_values_match_max() {
        let n = f64::NAN;
        let v = run(&[1.0, 1.0, 4.0, n, n, -3.0, -4.0, n, 5.0, n, n]);
        assert_eq!(v, vec![1.0, 0.0, 1.0, -3.0, 1.0, 5.0, 0.0, 0.0]);
    }
}
