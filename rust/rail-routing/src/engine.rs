//! One queue/operating transaction; economy and allocation metadata survive between ticks.
//! A reroute continuation commits finance only when the complete passenger step has finished.
use crate::{int, queues::Read, CORE};
pub(super) struct Settlement {
    token: f64,
    economy: Vec<f64>,
    loans: Vec<Vec<f64>>,
    statistics: bool,
    weights: Vec<(usize, f64)>,
}
fn read(frame: &[f64], state: &mut Option<Settlement>) {
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
fn settle(frame: &[f64], state: &mut Settlement, queue: &mut crate::queues::Queues) -> Vec<f64> {
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
