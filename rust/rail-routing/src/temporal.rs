//! Time-dependent demand and fleet rules shared by the continuous simulation.
use crate::{int, CORE};
pub(super) fn peak(minute: f64) -> bool {
    let m = ((minute % 1440.0) + 1440.0) % 1440.0;
    (m >= 420.0 && m < 540.0) || (m >= 1020.0 && m < 1140.0)
}
// purpose: work/shopping/leisure; external: none/staff-home/staff-other/departure/return/other.
pub(super) fn profile(purpose: usize, back: bool, minute: f64, external: usize) -> f64 {
    if external == 1 || external == 2 {
        return profile(0, external == 1, minute, 0);
    }
    let h = ((minute % 1440.0) + 1440.0) % 1440.0 / 60.0;
    if external != 0 {
        let departure = external == 3 || external == 4;
        let is_peak = if departure {
            h >= 5.0 && h < 10.0
        } else {
            h >= 16.0 && h < 22.0
        };
        let hours = if departure { 5.0 } else { 6.0 };
        return (if is_peak { 3.0 } else { 1.0 }) / (hours * 3.0 + 24.0 - hours) / 60.0;
    }
    let w = if purpose == 0 {
        if back {
            if h >= 17.0 && h < 21.0 {
                0.18
            } else if h >= 12.0 && h < 14.0 {
                0.06
            } else {
                0.008
            }
        } else if h >= 6.0 && h < 10.0 {
            0.19
        } else if h >= 10.0 && h < 12.0 {
            0.04
        } else {
            0.008
        }
    } else if purpose == 1 {
        if h >= 10.0 && h < 21.0 {
            0.08
        } else {
            0.008
        }
    } else if h >= 9.0 && h < 22.0 {
        0.07
    } else {
        0.008
    };
    let norm = if purpose == 0 {
        if back {
            4.0 * 0.18 + 2.0 * 0.06 + 18.0 * 0.008
        } else {
            4.0 * 0.19 + 2.0 * 0.04 + 18.0 * 0.008
        }
    } else if purpose == 1 {
        11.0 * 0.08 + 13.0 * 0.008
    } else {
        13.0 * 0.07 + 11.0 * 0.008
    };
    w / norm / 60.0
}
pub(super) fn allocations(total: f64, weights: &[f64]) -> Vec<f64> {
    let sum = weights.iter().fold(0.0, |a, b| a + b);
    if total == 0.0 || sum == 0.0 {
        return vec![0.0; weights.len()];
    }
    let mut out = vec![2.0; weights.len()];
    let remaining = (total - out.len() as f64 * 2.0) / 2.0;
    let shares = weights
        .iter()
        .map(|w| remaining * w / sum)
        .collect::<Vec<_>>();
    let floors = shares.iter().map(|v| v.floor()).collect::<Vec<_>>();
    for i in 0..out.len() {
        out[i] += floors[i] * 2.0;
    }
    let left = remaining - floors.iter().fold(0.0, |a, b| a + b);
    let mut order = (0..out.len()).collect::<Vec<_>>();
    order.sort_by(|&a, &b| {
        (shares[b] - floors[b])
            .partial_cmp(&(shares[a] - floors[a]))
            .unwrap()
            .then(a.cmp(&b))
    });
    for &i in order.iter().take(left.ceil().max(0.0) as usize) {
        out[i] += 2.0;
    }
    out
}
fn refresh(v: &[f64]) -> Vec<f64> {
    let now = v[2];
    let modern = v[3] != 0.0;
    let n = int(v[4]);
    let mut at = 5;
    let mut out = vec![1.0, n as f64];
    for _ in 0..n {
        let total = if v[at] == 0.0 {
            v[at + 5]
        } else if v[at + 1] != 0.0 {
            if peak(now) {
                v[at + 4]
            } else {
                v[at + 3]
            }
        } else {
            v[at + 2]
        };
        let nw = int(v[at + 6]);
        at += 7;
        let assigned = allocations(total, &v[at..at + nw]);
        at += nw;
        let pi = int(v[at]);
        let fleet = assigned[pi];
        let is_loop = v[at + 1] != 0.0;
        let dirs = v[at + 2];
        let duration = v[at + 3];
        let base_headway = v[at + 4];
        let nd = int(v[at + 5]);
        at += 6;
        let h = if modern {
            if fleet == 0.0 {
                f64::INFINITY
            } else {
                crate::demand::max(
                    2.0,
                    (if is_loop {
                        duration * dirs
                    } else {
                        2.0 * (duration + 1.0)
                    }) / fleet,
                )
            }
        } else if fleet == 0.0 {
            base_headway
        } else {
            crate::demand::max(base_headway, 2.0 * duration / fleet)
        };
        out.extend_from_slice(&[fleet, h, nd as f64]);
        for _ in 0..nd {
            let present = v[at] != 0.0;
            let next = v[at + 1];
            let old = v[at + 2];
            let last = if v[at + 3] != 0.0 { v[at + 4] } else { now };
            at += 5;
            let changed = present && h != old;
            let next = if changed {
                if h.is_finite() {
                    crate::demand::max(now, crate::demand::min(next, last + h))
                } else {
                    f64::INFINITY
                }
            } else {
                next
            };
            out.extend_from_slice(&[if changed { 1.0 } else { 0.0 }, next]);
        }
    }
    assert_eq!(at, v.len());
    out
}
fn run(v: &[f64]) -> Vec<f64> {
    assert_eq!(v[0], 1.0);
    match int(v[1]) {
        0 => {
            assert_eq!(v.len(), 3);
            let mut out = vec![1.0, if peak(v[2]) { 1.0 } else { 0.0 }];
            for p in 0..3 {
                for back in [false, true] {
                    for external in 0..6 {
                        out.push(profile(p, back, v[2], external));
                    }
                }
            }
            out
        }
        1 => {
            let n = int(v[8]);
            assert_eq!(v.len(), 9 + n);
            let off = if v[2] == 0.0 {
                v[7]
            } else if v[3] != 0.0 {
                v[5]
            } else {
                v[4]
            };
            let high = if v[2] == 0.0 {
                v[7]
            } else if v[3] != 0.0 {
                v[6]
            } else {
                v[4]
            };
            let mut out = vec![1.0, off, high, n as f64];
            out.extend(allocations(off, &v[9..]));
            out.extend(allocations(high, &v[9..]));
            out
        }
        2 => refresh(v),
        _ => panic!("unknown temporal operation"),
    }
}
#[no_mangle]
pub extern "C" fn temporal_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn temporal_run() -> *const f64 {
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
    fn directional_profiles_normalize() {
        for p in 0..3 {
            for back in [false, true] {
                for ext in 0..6 {
                    let s = (0..1440)
                        .map(|m| profile(p, back, m as f64, ext))
                        .sum::<f64>();
                    assert!((s - 1.0).abs() < 1e-12);
                }
            }
        }
    }
    #[test]
    fn allocation_ties_and_boundaries() {
        assert!(!peak(419.999));
        assert!(peak(420.0));
        assert!(!peak(540.0));
        assert_eq!(allocations(10.0, &[1.0, 1.0, 1.0]), vec![4.0, 4.0, 2.0]);
        assert_eq!(allocations(0.0, &[3.0, 1.0]), vec![0.0, 0.0]);
    }
}
