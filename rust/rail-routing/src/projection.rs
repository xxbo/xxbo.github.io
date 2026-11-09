//! View-only transport. Passenger, movement and accounting rules remain unchanged.
use std::cell::Cell;
thread_local! {
    static METRICS: Cell<(u64,u64,u64)> = const { Cell::new((0,0,0)) };
}
fn fields(action: f64) -> usize {
    match action as u8 {
        0 => 0,
        1 | 6 => 2,
        2 => 3,
        3 | 4 | 5 | 7 => 4,
        _ => panic!("unknown motion action"),
    }
}
pub(super) fn length(motion: &[f64]) -> usize {
    motion.chunks_exact(8).map(|r| fields(r[0])).sum()
}
pub(super) fn write(out: &mut Vec<f64>, order: &[usize], motion: &[f64]) {
    assert_eq!(motion.len(), order.len() * 8);
    let start = out.len();
    for (&uid, row) in order.iter().zip(motion.chunks_exact(8)) {
        if row[0] == 0.0 {
            continue;
        }
        out.extend_from_slice(&[uid as f64, row[0]]);
        match row[0] as u8 {
            1 | 6 => {}
            2 => out.push(row[1]),
            3 | 5 => out.extend_from_slice(&row[4..6]),
            4 => out.extend_from_slice(&row[6..8]),
            7 => out.extend_from_slice(&[row[5], row[7]]),
            _ => panic!("unknown motion action"),
        }
    }
    METRICS.with(|c| {
        let (full, sent, samples) = c.get();
        c.set((
            full + motion.len() as u64,
            sent + (out.len() - start) as u64,
            samples,
        ));
    });
}
pub(super) fn omit_samples(n: usize) {
    METRICS.with(|c| {
        let (full, sent, samples) = c.get();
        c.set((full, sent, samples + n as u64));
    });
}
#[no_mangle]
pub extern "C" fn projection_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn projection_full_values() -> f64 {
    METRICS.with(|c| c.get().0 as f64)
}
#[no_mangle]
pub extern "C" fn projection_sent_values() -> f64 {
    METRICS.with(|c| c.get().1 as f64)
}
#[no_mangle]
pub extern "C" fn projection_omitted_samples() -> f64 {
    METRICS.with(|c| c.get().2 as f64)
}
#[cfg(test)]
mod tests {
    #[test]
    fn all_actions_only_send_view_fields_in_train_order() {
        let mut motion = vec![];
        for action in 0..8 {
            motion.extend_from_slice(&[action as f64, 0.25, 100.0, 999.0, 4.0, 5.0, 6.0, 7.0]);
        }
        let mut out = vec![];
        super::write(&mut out, &[10, 11, 12, 13, 14, 15, 16, 17], &motion);
        assert_eq!(
            out,
            vec![
                11.0, 1.0, 12.0, 2.0, 0.25, 13.0, 3.0, 4.0, 5.0, 14.0, 4.0, 6.0, 7.0, 15.0, 5.0,
                4.0, 5.0, 16.0, 6.0, 17.0, 7.0, 5.0, 7.0
            ]
        );
        assert_eq!(out.len(), super::length(&motion));
        assert!(out.len() < motion.len());
    }
    #[test]
    fn idle_motion_is_empty() {
        let motion = vec![0.0; 80];
        let mut out = vec![42.0];
        super::write(&mut out, &(0..10).collect::<Vec<_>>(), &motion);
        assert_eq!(out, vec![42.0]);
        assert_eq!(super::length(&motion), 0);
    }
}
