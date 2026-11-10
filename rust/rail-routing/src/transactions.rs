//! Versioned structured cold transaction dispatcher.
use crate::{queues::Read, value, CORE};
#[no_mangle]
pub extern "C" fn transaction_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn transaction_run() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        let mut r = Read { v: &c.input, at: 0 };
        assert_eq!(r.f(), 1.0);
        let op = r.u();
        let input = value::read(&mut r);
        assert_eq!(r.at, c.input.len());
        let output = if op == 40 {
            crate::editor::with_config(|cfg| crate::assets::run(&input, cfg))
        } else if op == 30 {
            crate::connections::run(&input)
        } else if op < 20 {
            crate::urban::run(op, &input)
        } else {
            crate::migration::run(op, &input)
        };
        c.output = value::write(&output);
        c.output.as_ptr()
    })
}
