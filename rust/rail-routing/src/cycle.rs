//! Canonical runtime identities and fused preparation/queue/settlement transaction.
//! Unknown catalog templates yield before any passenger, train or cash mutation.
use crate::{int, queues::Read, CORE};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};
struct Profile {
    key: Rc<str>,
    service: f64,
    id: Option<usize>,
    data: Vec<f64>,
    lines: Vec<f64>,
}
pub(super) struct Cycle {
    token: f64,
    arrival: [f64; 3],
    carry: f64,
    next: usize,
    catalog: f64,
    count: usize,
    loaded: bool,
    keys: HashMap<Rc<str>, usize>,
    profiles: HashMap<usize, Profile>,
    pending: Option<(Vec<f64>, f64)>,
}
impl Cycle {
    pub(super) fn snapshot(&self, now: f64) -> [f64; 8] {
        [
            57.0,
            self.next as f64,
            self.arrival[0],
            self.arrival[1],
            self.arrival[2],
            self.carry,
            now,
            0.0,
        ]
    }
    pub(super) fn count(&self) -> usize {
        self.count
    }
}
fn string(bytes: &[u8], off: f64, len: f64) -> Rc<str> {
    Rc::from(
        std::str::from_utf8(&bytes[int(off)..int(off) + int(len)]).expect("invalid identity key"),
    )
}
fn line_ids(data: &[f64]) -> Vec<f64> {
    let at = 4 + int(data[3]) * 2;
    data[at + 1..at + 1 + int(data[at])].to_vec()
}
fn reply(
    status: f64,
    keys: bool,
    requests: &[usize],
    new: &[(usize, usize)],
    spawn: &[(usize, usize, usize)],
    serial: usize,
    next: usize,
    prep: &[f64],
    queue: &[f64],
    finance: &[f64],
) -> Vec<f64> {
    let mut out = vec![
        1.0,
        status,
        if keys { 1.0 } else { 0.0 },
        requests.len() as f64,
        new.len() as f64,
        spawn.len() as f64,
        serial as f64,
        next as f64,
        prep.len() as f64,
        queue.len() as f64,
        finance.len() as f64,
    ];
    out.extend(requests.iter().map(|&x| x as f64));
    for &(p, id) in new {
        out.extend_from_slice(&[p as f64, id as f64]);
    }
    for &(uid, source, ordinal) in spawn {
        out.extend_from_slice(&[uid as f64, source as f64, ordinal as f64]);
    }
    out.extend_from_slice(prep);
    out.extend_from_slice(queue);
    out.extend_from_slice(finance);
    out
}
#[no_mangle]
pub extern "C" fn cycle_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn cycle_bytes_resize(n: usize) -> *mut u8 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        c.cycle_bytes.resize(n, 0);
        if c.cycle_bytes.capacity() > 1024 * 1024 && n < c.cycle_bytes.capacity() / 4 {
            c.cycle_bytes.shrink_to_fit();
        }
        c.cycle_bytes.as_mut_ptr()
    })
}
#[no_mangle]
pub extern "C" fn engine_cycle() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core {
            input,
            output,
            cycle_bytes,
            cycle_state,
            sampling_state,
            feedback_cache,
            simulation_state,
            queue_state,
            settlement_state,
            ..
        } = &mut *c;
        *output = run(
            input,
            cycle_bytes,
            cycle_state,
            sampling_state,
            feedback_cache,
            simulation_state,
            queue_state,
            settlement_state,
        );
        output.as_ptr()
    })
}
pub(super) fn run(
    input: &[f64],
    cycle_bytes: &[u8],
    cycle_state: &mut Option<Cycle>,
    sampling_state: &mut Option<crate::simulation::Sampling>,
    feedback_cache: &mut crate::operations::CoverageCache,
    simulation_state: &mut Option<crate::simulation::MotionState>,
    queue_state: &mut Option<crate::queues::Queues>,
    settlement_state: &mut Option<crate::engine::Settlement>,
) -> Vec<f64> {
    assert!(input[0] == 1.0 || input[0] == 2.0);
    let token = input[1];
    let catalog = input[2];
    let count = int(input[3]);
    if !cycle_state
        .as_ref()
        .is_some_and(|s| s.token == token && s.catalog == catalog)
    {
        *cycle_state = Some(Cycle {
            token,
            arrival: if input[0] == 2.0 {
                [input[26], input[27], input[28]]
            } else {
                [0.0, 0.0, 2463534242.0]
            },
            carry: if input[0] == 2.0 { input[29] } else { 0.0 },
            next: int(input[5]),
            catalog,
            count,
            loaded: count == 0,
            keys: HashMap::new(),
            profiles: HashMap::new(),
            pending: None,
        });
    }
    let state = cycle_state.as_mut().unwrap();
    if let Some(q) = queue_state.as_mut() {
        for (key, id) in q.take_keys() {
            state.keys.insert(key, id);
            state.count = state.count.max(id + 1);
        }
    }
    assert!(count >= state.count);
    state.count = count;
    let sparse = input[0] == 2.0 && input[25] != 0.0;
    let mut r = Read {
        v: input,
        at: if input[0] == 2.0 { 30 } else { 25 },
    };
    let ids = (0..int(input[9])).map(|_| r.u()).collect::<Vec<_>>();
    if input[6] == 1.0 {
        state.keys.clear();
        state.loaded = true;
    }
    for _ in 0..int(input[7]) {
        let id = r.u();
        let key = string(cycle_bytes, r.f(), r.f());
        state.keys.insert(key, id);
    }
    for _ in 0..int(input[8]) {
        let p = r.u();
        let service = r.f();
        let key = string(cycle_bytes, r.f(), r.f());
        let n = r.u();
        let data = r.v[r.at..r.at + n].to_vec();
        r.at += n;
        let key = state
            .keys
            .get_key_value(&key)
            .map_or(key.clone(), |(k, _)| k.clone());
        state.profiles.insert(
            p,
            Profile {
                key,
                service,
                id: None,
                lines: line_ids(&data),
                data,
            },
        );
    }
    let templates = &input[r.at..r.at + int(input[12])];
    r.at += int(input[12]);
    let rules = &input[r.at..r.at + int(input[13])];
    r.at += int(input[13]);
    let prep = &input[r.at..r.at + int(input[10])];
    r.at += int(input[10]);
    let finance = &input[r.at..r.at + int(input[11])];
    r.at += int(input[11]);
    let mut parts = Vec::new();
    for k in 0..8 {
        let n = int(input[17 + k]);
        parts.push(&input[r.at..r.at + n]);
        r.at += n;
    }
    assert_eq!(r.at, input.len());
    assert!((2.0..=5.0).contains(&parts[0][0]));
    assert_eq!(parts[0][2], 0.0);
    let (prepared, minute) = if let Some(pending) = state.pending.take() {
        pending
    } else {
        let prepared = crate::engine::prepare(prep, sampling_state, feedback_cache);
        let minute = if prepared[2] > 0.0 {
            let off = 5 + int(prep[4]) + int(prep[1]);
            prep[off + 8]
        } else {
            parts[0][4]
        };
        (prepared, minute)
    };
    let nf = int(prepared[1]);
    let ns = int(prepared[2]);
    let nd = int(prepared[3]);
    let feedback = &prepared[4..4 + nf];
    let sample = &prepared[4 + nf..4 + nf + ns];
    let dispatch = &prepared[4 + nf + ns..];
    assert_eq!(dispatch.len(), nd);
    let now = parts[0][4];
    let day = ((minute % 1440.0) + 1440.0) % 1440.0;
    let mut open = HashSet::new();
    for row in rules[1..].chunks_exact(5) {
        if day >= row[1] && day < row[2] && (row[3] == 0.0 || row[4] > 0.0) {
            open.insert(int(row[0]));
        }
    }
    let mut requests = vec![];
    let mut seen = HashSet::new();
    let mut needs_keys = false;
    if ns > 0 {
        for row in sample[4..].chunks_exact(2) {
            let p = int(row[0]);
            if let Some(profile) = state.profiles.get(&p) {
                if profile.service >= 0.0 && open.contains(&int(profile.service)) && !state.loaded {
                    needs_keys = true;
                }
            } else if requests.len() < 2048 && seen.insert(p) {
                requests.push(p);
            }
        }
    }
    if !requests.is_empty() || needs_keys {
        state.pending = Some((prepared, minute));
        return reply(
            1.0,
            needs_keys,
            &requests,
            &[],
            &[],
            int(input[4]),
            int(input[5]),
            &[],
            &[],
            &[],
        );
    }
    let mut new = vec![];
    let mut definitions = vec![parts[2][0]];
    let mut arrivals = vec![];
    if ns > 0 {
        for (i, row) in sample[4..].chunks_exact(2).enumerate() {
            let p = int(row[0]);
            let profile = state.profiles.get_mut(&p).unwrap();
            let available = profile.service >= 0.0 && open.contains(&int(profile.service));
            let id = if available {
                if profile.id.is_none() {
                    let id = if let Some(&id) = state.keys.get(&profile.key) {
                        id
                    } else {
                        let id = state.count;
                        state.count += 1;
                        state.keys.insert(profile.key.clone(), id);
                        let mut data = std::mem::take(&mut profile.data);
                        data[0] = id as f64;
                        definitions[0] += 1.0;
                        definitions.extend(data);
                        new.push((p, id));
                        id
                    };
                    profile.id = Some(id);
                    profile.data = vec![];
                }
                profile.id.unwrap() as f64
            } else {
                -1.0
            };
            arrivals.extend_from_slice(&[id, i as f64, row[1], profile.lines.len() as f64]);
            arrivals.extend_from_slice(&profile.lines);
        }
    }
    let mut tr = Read {
        v: templates,
        at: 0,
    };
    let nt = tr.u();
    let mut serial = int(input[4]);
    let mut next = int(input[5]);
    let mut spawned = vec![];
    let mut train_data = parts[4].to_vec();
    let mut new_motion = vec![];
    let mut order = parts[6][1..1 + int(parts[6][0])].to_vec();
    for i in 0..nt {
        let nq = tr.u();
        let nm = tr.u();
        let dwell = tr.f();
        let q = &tr.v[tr.at..tr.at + nq];
        tr.at += nq;
        let m = &tr.v[tr.at..tr.at + nm];
        tr.at += nm;
        if dispatch[i * 2] != 1.0 {
            continue;
        }
        serial += 1;
        let uid = serial;
        spawned.push((uid, i, next));
        next += 1;
        train_data[0] += 1.0;
        train_data.push(uid as f64);
        train_data.extend_from_slice(q);
        let at = new_motion.len();
        new_motion.push(uid as f64);
        new_motion.extend_from_slice(m);
        new_motion[at + 10] = now + dwell;
        order.push(uid as f64);
    }
    assert_eq!(tr.at, templates.len());
    assert_eq!(nd, nt * 2);
    let old = parts[1];
    assert!(old[0] == 6.0 || old[0] == 11.0);
    let nb = int(old[5]);
    let at = 6 + nb;
    let prior = old[at];
    let update_at = at + 1 + if prior >= 0.0 { int(prior) } else { 0 };
    let mut motion = old[..at].to_vec();
    motion.push(order.len() as f64);
    motion.extend_from_slice(&order);
    motion.push(old[update_at] + spawned.len() as f64);
    motion.extend_from_slice(&old[update_at + 1..]);
    motion.extend(new_motion);
    let mut header = parts[0].to_vec();
    header[13] = motion.len() as f64;
    let mut tail = vec![order.len() as f64];
    tail.extend(order);
    tail.extend_from_slice(&[0.0, if ns > 0 { sample[3] } else { 0.0 }]);
    tail.extend(arrivals);
    let mut packet = vec![];
    packet.extend_from_slice(&header);
    packet.extend_from_slice(&motion);
    packet.push(definitions[0]);
    packet.extend_from_slice(&parts[2][1..]);
    packet.extend_from_slice(&definitions[1..]);
    drop(definitions);
    for p in [parts[3], &train_data, parts[5], &tail, parts[7]] {
        packet.extend_from_slice(p);
    }
    let mut patch = vec![];
    let mut maturity = vec![];
    if nf > 0 {
        let mut p = 2;
        for &id in &ids {
            maturity.push((id, feedback[p + 1], feedback[p + 2]));
            patch.push((
                id,
                [
                    feedback[p + 3],
                    feedback[p + 4],
                    feedback[p + 5],
                    feedback[p + 6],
                ],
            ));
            p += 8 + if feedback[p + 7] != 0.0 { 16 } else { 0 };
        }
        assert_eq!(p, feedback.len());
    }
    if !finance.is_empty() {
        crate::engine::read(finance, settlement_state);
    }
    let mut queue = crate::queues::run_compact(&packet, simulation_state, queue_state, &patch);
    if let Some(stats) = queue_state.as_mut().unwrap().finance_stats() {
        for (id, a, t) in maturity {
            stats.maturity(id, a, t);
        }
    }
    let account = if queue[1] == 0.0 && !finance.is_empty() {
        crate::engine::settle(
            finance,
            settlement_state.as_mut().unwrap(),
            queue_state.as_mut().unwrap(),
        )
    } else {
        vec![]
    };
    state.next = next;
    if !finance.is_empty() {
        state.carry = finance[6];
    } else if input[0] == 2.0 {
        state.carry = input[29];
    }
    if ns > 0 && parts[0][6] != 0.0 {
        state.arrival[0] += sample[0];
        state.arrival[1] = sample[1];
        state.arrival[2] = sample[2];
    }
    if sparse {
        queue.extend_from_slice(&queue_state.as_ref().unwrap().view()[17..]);
    }
    let mut view = vec![1.0, nf as f64, if ns > 0 { 4.0 } else { 0.0 }, nd as f64];
    view.extend_from_slice(feedback);
    if ns > 0 {
        view.extend_from_slice(&sample[..4]);
        crate::projection::omit_samples(ns - 4);
    }
    view.extend_from_slice(dispatch);
    reply(
        0.0,
        false,
        &[],
        &new,
        &spawned,
        serial,
        next,
        &view,
        &queue,
        &account,
    )
}
