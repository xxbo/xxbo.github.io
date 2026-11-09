//! One queue/operating transaction; economy and allocation metadata survive between ticks.
//! A reroute continuation commits finance only when the complete passenger step has finished.
use crate::{int, queues::Read, CORE};
pub(super) struct Settlement {
    pub(super) carry: f64,
    token: f64,
    pub(super) economy: Vec<f64>,
    pub(super) loans: Vec<Vec<f64>>,
    statistics: bool,
    weights: Vec<(usize, f64)>,
}
pub(super) fn read(frame: &[f64], state: &mut Option<Settlement>) {
    assert_eq!(frame[0], 1.0);
    if frame[2] != 0.0 {
        let mut r = Read { v: frame, at: 16 };
        let economy = (0..9).map(|_| r.f()).collect();
        let loans = (0..r.u())
            .map(|i| {
                let mut l = vec![i as f64];
                l.extend((0..4).map(|_| r.f()));
                l
            })
            .collect();
        let statistics = r.f() != 0.0;
        let weights = (0..r.u()).map(|_| (r.u(), r.f())).collect();
        assert_eq!(r.at, frame.len());
        *state = Some(Settlement {
            carry: frame[6],
            token: frame[1],
            economy,
            loans,
            statistics,
            weights,
        });
    } else {
        assert_eq!(frame.len(), 16);
    }
    assert_eq!(
        state.as_ref().expect("economic state missing").token,
        frame[1]
    );
}
pub(super) fn settle(
    frame: &[f64],
    state: &mut Settlement,
    queue: &mut crate::queues::Queues,
) -> Vec<f64> {
    let mut input = vec![
        1.0,
        2.0,
        frame[3],
        frame[4],
        frame[5],
        queue.counter(6) - frame[7],
        queue.counter(7) - frame[8],
        frame[9],
        frame[10],
        frame[11],
        frame[12],
        frame[13],
        frame[14],
        frame[6],
    ];
    input.extend_from_slice(&state.economy);
    input.push(state.loans.len() as f64);
    for loan in &state.loans {
        input.extend_from_slice(&loan[1..]);
    }
    input.push(if state.statistics {
        (state.weights.len() + 1) as f64
    } else {
        0.0
    });
    if state.statistics {
        input.push(frame[15]);
        for &(id, weight) in &state.weights {
            let previous = queue.finance_stats().map_or(f64::NAN, |s| s.operating(id));
            input.extend_from_slice(&[previous, weight]);
        }
    }
    let mut output = crate::operations::run(&input);
    state.economy.copy_from_slice(&output[8..17]);
    state.carry = frame[6];
    let n = int(output[17]);
    let mut at = 18;
    state.loans.clear();
    for _ in 0..n {
        state.loans.push(output[at..at + 5].to_vec());
        at += 5;
    }
    let payments = int(output[at]);
    at += 1 + payments;
    let allocations = int(output[at]);
    at += 1;
    if allocations > 0 {
        assert_eq!(allocations, state.weights.len() + 1);
        if let Some(stats) = queue.finance_stats() {
            stats.day_operating(output[at]);
            for (i, &(id, _)) in state.weights.iter().enumerate() {
                stats.set_operating(id, output[at + 1 + i]);
            }
        }
    }
    // Precompute the next common UI request without a separate clock call on the next frame.
    let dt = if state.economy[8] != 0.0 {
        0.0
    } else {
        crate::operations::next(frame[3], 0.1, &state.loans)
    };
    let target = if dt > 1e-9 { frame[3] + dt } else { frame[3] };
    let (carry, interval) = crate::operations::generation(frame[6], dt);
    output.extend_from_slice(&[dt, target, carry, interval]);
    output
}
#[no_mangle]
pub extern "C" fn engine_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn engine_step() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core {
            input,
            output,
            simulation_state,
            queue_state,
            settlement_state,
            ..
        } = &mut *c;
        let nq = int(input[0]);
        let nf = int(input[1]);
        assert_eq!(input.len(), 2 + nq + nf);
        let financial = &input[2 + nq..];
        read(financial, settlement_state);
        let mut result = crate::queues::run(&input[2..2 + nq], simulation_state, queue_state, 3);
        if input[2] == 3.0 {
            result.extend_from_slice(&queue_state.as_ref().unwrap().view()[17..]);
        }
        let qlen = result.len() - 3;
        let fin = if result[4] == 0.0 {
            settle(
                financial,
                settlement_state.as_mut().unwrap(),
                queue_state.as_mut().unwrap(),
            )
        } else {
            vec![]
        };
        result[0] = 1.0;
        result[1] = qlen as f64;
        result[2] = fin.len() as f64;
        result.extend(fin);
        *output = result;
        output.as_ptr()
    })
}

/// Minute preparation preserves feedback -> sampling -> dispatch order without host round trips.
#[no_mangle]
pub extern "C" fn engine_prepare_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn engine_prepare() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core {
            input,
            output,
            sampling_state,
            feedback_cache,
            ..
        } = &mut *c;
        *output = prepare(input, sampling_state, feedback_cache);
        output.as_ptr()
    })
}
pub(super) fn prepare(
    input: &[f64],
    sampling_state: &mut Option<crate::simulation::Sampling>,
    feedback_cache: &mut crate::operations::CoverageCache,
) -> Vec<f64> {
    assert_eq!(input[0], 1.0);
    let nf = int(input[1]);
    let ns = int(input[2]);
    let nd = int(input[3]);
    let nm = int(input[4]);
    let at = 5 + nm;
    assert_eq!(input.len(), at + nf + ns + nd);
    let feedback = if nf > 0 {
        crate::operations::run_cached(&input[at..at + nf], feedback_cache)
    } else {
        vec![]
    };
    let sampled = if ns > 0 {
        let v = &input[at + nf..at + nf + ns];
        assert_eq!(v[0], 9.0);
        assert_eq!(nm, int(v[12]));
        let mut rows = v[13..13 + nm * 4].to_vec();
        if !feedback.is_empty() {
            let mut offsets = vec![];
            let mut p = 2;
            for _ in 0..int(feedback[1]) {
                offsets.push(p);
                p += 8 + if feedback[p + 7] != 0.0 { 16 } else { 0 };
            }
            assert_eq!(p, feedback.len());
            for i in 0..nm {
                let id = input[5 + i];
                if id < 0.0 {
                    continue;
                }
                let p = offsets[int(id)];
                rows[i * 4 + 2] = feedback[p + 1];
                rows[i * 4 + 3] = feedback[p + 2];
                if feedback[p + 7] != 0.0 {
                    rows[i * 4 + 1] = feedback[p + 23];
                }
            }
        }
        crate::simulation::timed_sample_rows(v, sampling_state, Some(&rows))
    } else {
        assert_eq!(nm, 0);
        vec![]
    };
    let dispatch = if nd > 0 {
        crate::simulation::dispatch(&input[at + nf + ns..])
    } else {
        vec![]
    };
    let mut output = vec![
        1.0,
        feedback.len() as f64,
        sampled.len() as f64,
        dispatch.len() as f64,
    ];
    output.extend(feedback);
    output.extend(sampled);
    output.extend(dispatch);
    output
}

// Bounded native loop between host-owned minute, dispatch, city and review barriers.
// Every substep returns ordered projections so save and insertion-order semantics survive.
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "rail_math")]
extern "C" {
    fn now() -> f64;
}
pub(super) fn monotonic() -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        0.0
    }
}
pub(super) fn day_operating(account: &[f64], previous: f64) -> f64 {
    let at = 18 + int(account[17]) * 5;
    let p = at + 1 + int(account[at]);
    if account[p] > 0.0 {
        account[p + 1]
    } else {
        previous
    }
}
#[no_mangle]
pub extern "C" fn engine_continue_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn engine_continue() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        let crate::Core {
            input,
            output,
            simulation_state,
            queue_state,
            settlement_state,
            ..
        } = &mut *c;
        // token, time, remaining, max steps, wall budget, exclusive host barrier, stats flag, finance frame
        let mut time = input[1];
        let mut remaining = input[2];
        let max = int(input[3]);
        let budget = input[4];
        let barrier = input[5];
        let stats = input[6];
        let mut fin = input[7..].to_vec();
        let mut chunks = vec![];
        let mut steps = 0;
        let start = monotonic();
        let mut reason = 0.0;
        loop {
            if remaining < 0.1 || steps >= max {
                break;
            }
            if time + 0.1 >= barrier - 1e-8 {
                reason = 1.0;
                break;
            }
            let bank = settlement_state.as_ref().expect("bank missing");
            if bank.economy[8] != 0.0 {
                reason = 2.0;
                break;
            }
            if crate::operations::next(time, 0.1, &bank.loans) != 0.1 {
                reason = 1.0;
                break;
            }
            let (carry, interval) = crate::operations::generation(fin[6], 0.1);
            if interval != 0.0 {
                reason = 1.0;
                break;
            }
            let next = time + 0.1;
            let (motion, order) = crate::simulation::continuation(simulation_state, next);
            let q = queue_state.as_ref().expect("queue missing");
            fin[2] = 0.0;
            fin.truncate(16);
            fin[3] = next;
            fin[4] = 0.1;
            fin[5] = 0.1;
            fin[6] = carry;
            fin[7] = q.counter(6);
            fin[8] = q.counter(7);
            let native_routes = q.native_routes();
            let mut packet = vec![
                q.protocol(),
                input[0],
                0.0,
                0.0,
                next,
                1.0,
                1.0,
                0.03,
                0.0,
                0.0,
                -1.0,
                -1.0,
                0.0,
                motion.len() as f64,
            ];
            // Preserve route model, integer mode and transfer duration from the committed cycle.
            packet[5] = input[23];
            packet[6] = input[24];
            packet[7] = input[25];
            packet.extend(motion);
            packet.extend_from_slice(&[0.0, 0.0, 0.0]);
            packet.push(order.len() as f64);
            packet.extend(order.iter().map(|&id| id as f64));
            packet.extend_from_slice(&[0.0, 0.0]);
            if stats != 0.0 {
                packet.extend_from_slice(&[0.0, 0.0]);
            } else {
                packet.push(-1.0);
            }
            if native_routes {
                packet.push(0.0);
            }
            let queue = crate::queues::run_compact(&packet, simulation_state, queue_state, &[]);
            let account = if queue[1] == 0.0 {
                settle(
                    &fin,
                    settlement_state.as_mut().unwrap(),
                    queue_state.as_mut().unwrap(),
                )
            } else {
                vec![]
            };
            time = next;
            remaining -= 0.1;
            steps += 1;
            chunks.extend_from_slice(&[time, carry, queue.len() as f64, account.len() as f64]);
            chunks.extend_from_slice(&queue);
            chunks.extend_from_slice(&account);
            if queue[1] != 0.0 {
                reason = 3.0;
                break;
            }
            fin[15] = day_operating(&account, fin[15]);
            if account[16] != 0.0 {
                reason = 2.0;
                break;
            }
            if monotonic() - start >= budget {
                reason = 4.0;
                break;
            }
        }
        *output = vec![1.0, steps as f64, remaining, reason];
        output.extend(chunks);
        if input.get(26) == Some(&1.0) {
            output.extend(queue_state.as_ref().unwrap().view());
        }
        output.as_ptr()
    })
}
