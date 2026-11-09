//! Forecast contracts stay in a compact numeric table until an actual trip needs a view.
use crate::{int, queues::Read, CORE};
#[no_mangle]
pub extern "C" fn catalog_abi() -> u32 {
    1
}
pub(super) struct View {
    token: f64,
    count: usize,
    data: Vec<f64>,
}
#[no_mangle]
pub extern "C" fn catalog_view_token() -> f64 {
    CORE.with(|c| c.borrow().catalog_view.as_ref().map_or(0.0, |v| v.token))
}
#[no_mangle]
pub extern "C" fn catalog_summary() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        let input = &c.input;
        assert_eq!(input[0], 1.0);
        let token = input[1];
        let load = input[2] != 0.0;
        let model = input[3];
        let nl = int(input[4]);
        let count = int(input[5]);
        let rows = input[6..6 + nl * 4].to_vec();
        if load {
            c.catalog_view = Some(View {
                token,
                count,
                data: input[6 + nl * 4..].to_vec(),
            });
        }
        let view = c.catalog_view.as_ref().unwrap();
        assert_eq!(view.token, token);
        assert_eq!(view.count, count);
        let mut r = Read {
            v: &view.data,
            at: 0,
        };
        let (mut expected, mut journeys, mut km, mut transfers) = (0.0, 0.0, 0.0, 0.0);
        let mut stations = std::collections::BTreeMap::<usize, [f64; 2]>::new();
        for _ in 0..count {
            let mut h = [0.0; 24];
            for v in &mut h {
                *v = r.f();
            }
            r.at += int(h[23]);
            let n = r.u();
            let mut factor = 1.0_f64;
            let mut first = true;
            for _ in 0..n {
                let id = r.u();
                r.f();
                let row = &rows[id * 4..id * 4 + 4];
                let value = crate::simulation::catalog_factor(model, h[10] >= 0.0, row);
                factor = if first {
                    value
                } else {
                    crate::demand::min(factor, value)
                };
                first = false;
            }
            expected += h[5] * factor;
            let trips = h[4] * factor;
            journeys += trips;
            km += trips * h[21];
            if h[22] > 0.0 {
                transfers += trips;
            }
            stations.entry(int(h[0])).or_default()[0] += trips;
            stations.entry(int(h[1])).or_default()[1] += trips;
        }
        assert_eq!(r.at, view.data.len());
        let mut out = vec![expected, journeys, km, transfers, stations.len() as f64];
        for (id, v) in stations {
            out.extend([id as f64, v[0], v[1]]);
        }
        c.output = out;
        c.output.as_ptr()
    })
}
fn run(input: &[f64]) -> Vec<f64> {
    let mut r = Read { v: input, at: 0 };
    assert_eq!(r.f(), 1.0);
    let count = r.u();
    let ne = r.u();
    let edges = (0..ne)
        .map(|_| [r.f(), r.f(), r.f(), r.f()])
        .collect::<Vec<_>>();
    let mut out = vec![count as f64];
    for id in 0..count {
        let header = (0..24).map(|_| r.f()).collect::<Vec<_>>();
        let from = header[0];
        let mut origin = from;
        let mut legs: Vec<[f64; 4]> = vec![];
        let mut route = vec![];
        for _ in 0..int(header[23]) {
            let ix = r.u();
            route.push(ix);
            let e = edges[ix];
            if let Some(last) = legs.last_mut() {
                if last[0] == e[0] && last[1] == e[1] {
                    last[3] = e[2];
                    origin = e[2];
                    continue;
                }
            }
            legs.push([e[0], e[1], origin, e[2]]);
            origin = e[2];
        }
        let nf = r.u();
        let fares = (0..nf).map(|_| (r.f(), r.f())).collect::<Vec<_>>();
        let mut shares = vec![];
        if header[20] > 0.0 {
            for (line, amount) in &fares {
                shares.push((*line, *amount / header[20]));
            }
        } else {
            for ix in route {
                let e = edges[ix];
                if let Some((_, v)) = shares.iter_mut().find(|(line, _)| *line == e[0]) {
                    *v += e[3] / header[21];
                } else {
                    shares.push((e[0], e[3] / header[21]));
                }
            }
        }
        let mut row = vec![
            id as f64,
            header[5],
            header[20],
            header[2],
            header[3],
            header[10],
            header[11],
            header[0],
            header[1],
            legs.len() as f64,
        ];
        for leg in legs {
            row.extend(leg)
        }
        row.push(fares.len() as f64);
        for (line, _) in &fares {
            row.push(*line)
        }
        row.push(shares.len() as f64);
        row.push(if header[20] > 0.0 { 0.0 } else { 1.0 });
        for (line, share) in shares {
            row.extend([line, share]);
        }
        out.push(row.len() as f64);
        out.extend(row);
    }
    assert_eq!(r.at, input.len());
    out
}
#[no_mangle]
pub extern "C" fn catalog_run() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        c.output = run(&c.input);
        c.output.as_ptr()
    })
}
#[no_mangle]
pub extern "C" fn compact_run() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        assert_eq!(c.input[0], 1.0);
        let count = int(c.input[1]);
        let mut ids = c.input[2..]
            .iter()
            .map(|v| int(*v))
            .filter(|id| *id < count)
            .collect::<std::collections::BTreeSet<_>>();
        c.output = ids.iter().map(|id| *id as f64).collect();
        ids.clear();
        c.output.as_ptr()
    })
}
