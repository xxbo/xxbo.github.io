//! Persistent passenger state and ordered event transactions. No JS model callbacks.
use crate::demand::{max, min};
use crate::numbers::{Map as HashMap, Set as HashSet};
use crate::{int, CORE};
use std::collections::BTreeMap;
use std::hash::Hash;
#[derive(Clone)]
struct Ordered<K, V> {
    index: HashMap<K, usize>,
    rows: Vec<Option<(K, V)>>,
}
impl<K: Copy + Eq + Hash, V: Copy> Ordered<K, V> {
    fn new() -> Self {
        Self {
            index: HashMap::default(),
            rows: vec![],
        }
    }
    fn get(&self, k: K) -> Option<V> {
        self.index
            .get(&k)
            .and_then(|&i| self.rows[i].as_ref().map(|x| x.1))
    }
    fn set(&mut self, k: K, v: V) {
        if let Some(&i) = self.index.get(&k) {
            self.rows[i] = Some((k, v));
        } else {
            self.index.insert(k, self.rows.len());
            self.rows.push(Some((k, v)));
        }
    }
    fn remove(&mut self, k: K) {
        if let Some(i) = self.index.remove(&k) {
            self.rows[i] = None;
        }
        if self.rows.len() > self.index.len() * 2 + 64 {
            let rows = std::mem::take(&mut self.rows);
            self.index.clear();
            for (k, v) in rows.into_iter().flatten() {
                self.set(k, v);
            }
        }
    }
    fn clear(&mut self) {
        self.index.clear();
        self.rows.clear();
    }
    fn keys(&self) -> Vec<K> {
        self.rows.iter().flatten().map(|x| x.0).collect()
    }
    fn sum(&self, f: impl Fn(V) -> f64) -> f64 {
        self.rows.iter().flatten().fold(0.0, |v, x| v + f(x.1))
    }
}
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Token {
    j: usize,
    leg: usize,
    stamp: i64,
}
#[derive(Clone, Copy)]
struct Cohort {
    n: f64,
    since: Option<f64>,
}
type Key = (usize, i32, usize);
struct Leg {
    service: usize,
    dir: i32,
    from: usize,
    to: usize,
    valid: bool,
}
struct Journey {
    fare: f64,
    purpose: usize,
    byline: Vec<(usize, f64)>,
    legs: Vec<Leg>,
}
struct Cargo {
    service: usize,
    parent: usize,
    capacity: f64,
    dir: i32,
    is_loop: bool,
    stops: Vec<usize>,
    calls: HashSet<usize>,
    onboard: f64,
    passengers: Ordered<Token, f64>,
}
#[derive(Clone, Copy)]
struct Transfer {
    j: usize,
    leg: usize,
    n: f64,
    ready: f64,
    _station: usize,
}
struct Read<'a> {
    v: &'a [f64],
    at: usize,
}
impl<'a> Read<'a> {
    fn f(&mut self) -> f64 {
        let x = self.v[self.at];
        self.at += 1;
        x
    }
    fn u(&mut self) -> usize {
        int(self.f())
    }
    fn tok(&mut self) -> Token {
        Token {
            j: self.u(),
            leg: self.u(),
            stamp: self.f() as i64,
        }
    }
    fn cohort(&mut self) -> (Token, Cohort) {
        let t = self.tok();
        let n = self.f();
        let since = self.f();
        (
            t,
            Cohort {
                n,
                since: if since.is_nan() { None } else { Some(since) },
            },
        )
    }
}
pub(super) struct Queues {
    token: f64,
    now: f64,
    modern: bool,
    integer: bool,
    transfer: f64,
    defs: HashMap<usize, Journey>,
    limits: HashMap<usize, (f64, f64)>,
    trains: HashMap<usize, Cargo>,
    queues: HashMap<Key, Ordered<Token, Cohort>>,
    queue_order: Vec<Key>,
    outside: BTreeMap<usize, Ordered<Token, Cohort>>,
    occupancy: BTreeMap<usize, f64>,
    transfers: Vec<Transfer>,
    counters: [f64; 8],
    dirty: u32,
    revenue: Ordered<usize, f64>,
    boarded: Ordered<usize, f64>,
    purposes: Ordered<usize, f64>,
    commands: Vec<f64>,
    changed: HashSet<usize>,
    revenue_delta: Ordered<usize, f64>,
    boarded_delta: Ordered<usize, f64>,
    purpose_delta: Ordered<usize, f64>,
}
impl Queues {
    fn new(token: f64) -> Self {
        Self {
            token,
            now: 0.0,
            modern: false,
            integer: false,
            transfer: 0.0,
            defs: HashMap::default(),
            limits: HashMap::default(),
            trains: HashMap::default(),
            queues: HashMap::default(),
            queue_order: vec![],
            outside: BTreeMap::new(),
            occupancy: BTreeMap::new(),
            transfers: vec![],
            counters: [0.0; 8],
            dirty: 0,
            revenue: Ordered::new(),
            boarded: Ordered::new(),
            purposes: Ordered::new(),
            commands: vec![],
            changed: HashSet::default(),
            revenue_delta: Ordered::new(),
            boarded_delta: Ordered::new(),
            purpose_delta: Ordered::new(),
        }
    }
    fn cmd(&mut self, op: f64, args: &[f64]) {
        self.commands.push(op);
        self.commands.extend_from_slice(args);
        for _ in args.len()..7 {
            self.commands.push(0.0);
        }
    }
    fn inc(&mut self, i: usize, n: f64) {
        self.counters[i] += n;
        self.dirty |= 1 << i;
    }
    fn event(
        &mut self,
        kind: usize,
        j: usize,
        n: f64,
        wait: f64,
        line: Option<usize>,
        station: Option<usize>,
    ) {
        self.cmd(
            1.0,
            &[
                kind as f64,
                j as f64,
                n,
                wait,
                line.map_or(-1.0, |x| x as f64),
                station.map_or(-1.0, |x| x as f64),
            ],
        );
    }
    fn occ(&mut self, id: usize, n: f64) {
        self.occupancy.insert(id, n);
        self.cmd(7.0, &[id as f64, n]);
    }
    fn queue(&mut self, key: Key) -> &mut Ordered<Token, Cohort> {
        if !self.queues.contains_key(&key) {
            self.queues.insert(key, Ordered::new());
            self.queue_order.push(key);
        }
        self.queues.get_mut(&key).unwrap()
    }
    fn qcmd(&mut self, op: f64, k: Key, t: Token, v: f64) {
        self.cmd(
            op,
            &[
                k.0 as f64,
                k.1 as f64,
                k.2 as f64,
                t.j as f64,
                t.leg as f64,
                t.stamp as f64,
                v,
            ],
        );
    }
    fn ocmd(&mut self, op: f64, id: usize, t: Token, v: f64) {
        self.cmd(
            op,
            &[id as f64, t.j as f64, t.leg as f64, t.stamp as f64, v],
        );
    }
    fn pcmd(&mut self, id: usize, t: Token, v: f64) {
        self.cmd(
            8.0,
            &[id as f64, t.j as f64, t.leg as f64, t.stamp as f64, v],
        );
    }
    fn enqueue(&mut self, j: usize, leg: usize, n: f64, reserved: bool) {
        let l = &self.defs[&j].legs[leg];
        let k = (l.service, l.dir, l.from);
        let id = l.from;
        let t = Token {
            j,
            leg,
            stamp: if self.integer {
                self.now.floor() as i64
            } else {
                -1
            },
        };
        let prior = self.queue(k).get(t);
        let since = if prior.map_or(true, |c| c.n == 0.0) {
            Some(self.now)
        } else {
            prior.unwrap().since
        };
        if prior.map_or(true, |c| c.n == 0.0) {
            self.qcmd(4.0, k, t, self.now);
        }
        let value = prior.map_or(0.0, |c| c.n) + n;
        self.queue(k).set(t, Cohort { n: value, since });
        self.qcmd(3.0, k, t, value);
        if !reserved {
            self.occ(id, self.occupancy.get(&id).copied().unwrap_or(0.0) + n);
        }
    }
    fn waiting(&mut self, j: usize, leg: usize, n: f64) {
        if n <= 0.0 {
            return;
        }
        let id = self.defs[&j].legs[leg].from;
        self.occ(id, self.occupancy.get(&id).copied().unwrap_or(0.0) + n);
        let t = Transfer {
            j,
            leg,
            n,
            ready: self.now + self.transfer,
            _station: id,
        };
        self.transfers.push(t);
        self.cmd(11.0, &[j as f64, leg as f64, n, t.ready, id as f64]);
    }
    fn reject(&mut self, j: usize, n: f64) {
        if n <= 0.0 {
            return;
        }
        self.inc(4, n);
        self.inc(5, n);
        self.event(4, j, n, 0.0, None, None);
    }
    fn admit(&mut self, j: usize, leg: usize, n: f64, transfer: bool) {
        if !self.modern {
            if transfer {
                self.waiting(j, leg, n)
            } else {
                self.enqueue(j, leg, n, false)
            }
            return;
        }
        let id = self.defs[&j].legs[leg].from;
        let limit = self.limits[&id];
        let inside = max(
            0.0,
            min(n, limit.0 - self.occupancy.get(&id).copied().unwrap_or(0.0)),
        );
        if inside != 0.0 {
            if !transfer && leg == 0 {
                self.event(1, j, inside, 0.0, None, Some(id));
            }
            if transfer {
                self.waiting(j, leg, inside)
            } else {
                self.enqueue(j, leg, inside, false)
            }
        }
        let mut rest = n - inside;
        if rest > 0.0 {
            if !self.outside.contains_key(&id) {
                self.outside.insert(id, Ordered::new());
                self.cmd(16.0, &[id as f64]);
            }
            let total = self.outside[&id].sum(|c| c.n);
            let take = max(0.0, min(rest, limit.1 - total));
            if take != 0.0 {
                let t = Token {
                    j,
                    leg,
                    stamp: self.now.floor() as i64,
                };
                let old = self.outside[&id].get(t);
                let since = if old.map_or(true, |c| c.n == 0.0) {
                    Some(self.now)
                } else {
                    old.unwrap().since
                };
                if old.map_or(true, |c| c.n == 0.0) {
                    self.ocmd(6.0, id, t, self.now);
                }
                let value = old.map_or(0.0, |c| c.n) + take;
                self.outside
                    .get_mut(&id)
                    .unwrap()
                    .set(t, Cohort { n: value, since });
                self.ocmd(5.0, id, t, value);
                rest -= take;
            }
            self.reject(j, rest);
        }
    }
    fn qremove(&mut self, k: Key, t: Token) {
        self.queue(k).remove(t);
        self.qcmd(3.0, k, t, f64::NAN);
        self.qcmd(4.0, k, t, f64::NAN);
    }
    fn oremove(&mut self, id: usize, t: Token) {
        self.outside.get_mut(&id).unwrap().remove(t);
        self.ocmd(5.0, id, t, f64::NAN);
        self.ocmd(6.0, id, t, f64::NAN);
    }
    fn release(&mut self) {
        let mut i = 0;
        while i < self.transfers.len() {
            let x = self.transfers[i];
            if x.ready <= self.now {
                self.enqueue(x.j, x.leg, x.n, true);
                self.transfers.remove(i);
                self.cmd(12.0, &[i as f64]);
            } else {
                i += 1;
            }
        }
    }
    fn gates(&mut self) {
        let stations = self.outside.keys().copied().collect::<Vec<_>>();
        for id in stations {
            let limit = self.limits[&id];
            for t in self.outside[&id].keys() {
                let c = self.outside[&id].get(t).unwrap();
                let since = c.since.unwrap_or(self.now);
                if self.now - since >= 15.0 {
                    self.reject(t.j, c.n);
                    self.oremove(id, t);
                    continue;
                }
                if t.leg > 0 && self.now - since < self.transfer {
                    continue;
                }
                let take = max(
                    0.0,
                    min(
                        c.n,
                        limit.0 - self.occupancy.get(&id).copied().unwrap_or(0.0),
                    ),
                );
                if take != 0.0 {
                    if t.leg == 0 {
                        self.event(1, t.j, take, 0.0, None, Some(id));
                    }
                    self.enqueue(t.j, t.leg, take, false);
                    let left = c.n - take;
                    self.outside.get_mut(&id).unwrap().set(
                        t,
                        Cohort {
                            n: left,
                            since: c.since,
                        },
                    );
                    self.ocmd(5.0, id, t, left);
                    if left < 1e-9 {
                        self.oremove(id, t);
                    }
                }
            }
        }
        for k in self.queue_order.clone() {
            for t in self.queues[&k].keys() {
                let c = self.queues[&k].get(t).unwrap();
                if self.now - c.since.unwrap_or(self.now) > 60.0 {
                    self.reject(t.j, c.n);
                    self.occ(
                        k.2,
                        max(0.0, self.occupancy.get(&k.2).copied().unwrap_or(0.0) - c.n),
                    );
                    self.qremove(k, t);
                }
            }
        }
    }
    fn board(&mut self, id: usize, station: usize, here: usize) {
        let t = &self.trains[&id];
        let k = (t.service, t.dir, station);
        if !self.queues.contains_key(&k) {
            return;
        }
        let mut remaining = t.capacity - t.onboard;
        for token in self.queues[&k].keys() {
            let c = self.queues[&k].get(token).unwrap();
            let wait = self.now - c.since.unwrap_or(self.now);
            if c.n < 1e-10 {
                self.qremove(k, token);
                continue;
            }
            if wait > 60.0 {
                self.reject(token.j, c.n);
                self.occ(
                    station,
                    max(
                        0.0,
                        self.occupancy.get(&station).copied().unwrap_or(0.0) - c.n,
                    ),
                );
                self.qremove(k, token);
                continue;
            }
            let l = self.defs.get(&token.j).and_then(|j| j.legs.get(token.leg));
            let t = &self.trains[&id];
            let eligible = l.map_or(false, |l| {
                t.calls.contains(&l.to)
                    && (t.is_loop
                        || ((t
                            .stops
                            .iter()
                            .position(|&n| n == l.to)
                            .map_or(-1.0, |i| i as f64)
                            - here as f64)
                            * t.dir as f64
                            > 0.0))
            });
            if !eligible {
                continue;
            }
            let take = min(remaining, c.n);
            if take <= 0.0 {
                break;
            }
            let cargo = self.trains.get_mut(&id).unwrap();
            let value = cargo.passengers.get(token).unwrap_or(0.0) + take;
            cargo.passengers.set(token, value);
            cargo.onboard += take;
            let parent = cargo.parent;
            self.pcmd(id, token, value);
            self.changed.insert(id);
            self.inc(1, take);
            self.occ(
                station,
                max(
                    0.0,
                    self.occupancy.get(&station).copied().unwrap_or(0.0) - take,
                ),
            );
            self.event(2, token.j, take, wait, Some(parent), Some(station));
            let boarded = self.boarded.get(k.0).unwrap_or(0.0) + take;
            self.boarded.set(k.0, boarded);
            self.boarded_delta.set(k.0, boarded);
            let left = c.n - take;
            self.queue(k).set(
                token,
                Cohort {
                    n: left,
                    since: c.since,
                },
            );
            remaining -= take;
            if left < 1e-9 {
                self.qremove(k, token);
            } else {
                self.qcmd(3.0, k, token, left);
            }
            if remaining < 1e-8 {
                break;
            }
        }
    }
    fn unload(&mut self, id: usize, station: usize) -> Option<(usize, usize, f64)> {
        let keys = self.trains[&id].passengers.keys();
        for token in keys {
            let count = self.trains[&id].passengers.get(token).unwrap();
            let valid = self
                .defs
                .get(&token.j)
                .and_then(|j| j.legs.get(token.leg))
                .map_or(false, |l| l.to == station);
            if !valid {
                continue;
            }
            let cargo = self.trains.get_mut(&id).unwrap();
            cargo.onboard -= count;
            self.changed.insert(id);
            self.inc(2, count);
            self.event(3, token.j, count, 0.0, None, Some(station));
            self.trains.get_mut(&id).unwrap().passengers.remove(token);
            self.pcmd(id, token, f64::NAN);
            if let Some(next) = self.defs[&token.j].legs.get(token.leg + 1) {
                if next.valid {
                    self.admit(token.j, token.leg + 1, count, true);
                } else {
                    return Some((token.j, station, count));
                }
            } else {
                self.inc(3, count);
                self.event(5, token.j, count, 0.0, None, None);
                let j = &self.defs[&token.j];
                let fare = j.fare;
                let purpose = j.purpose;
                let byline = j.byline.clone();
                self.inc(6, count * fare);
                let value = self.purposes.get(purpose).unwrap_or(f64::NAN) + count;
                self.purposes.set(purpose, value);
                self.purpose_delta.set(purpose, value);
                for (line, share) in byline {
                    let value = self.revenue.get(line).unwrap_or(0.0) + count * fare * share;
                    self.revenue.set(line, value);
                    self.revenue_delta.set(line, value);
                }
            }
        }
        let cargo = self.trains.get_mut(&id).unwrap();
        let value = max(0.0, cargo.onboard);
        if value != cargo.onboard {
            cargo.onboard = value;
            self.changed.insert(id);
        }
        None
    }
    fn finish(&mut self, id: usize, clear: bool) {
        let cargo = self.trains.get_mut(&id).unwrap();
        let n = cargo.onboard;
        cargo.onboard = 0.0;
        if clear {
            cargo.passengers = Ordered::new();
        }
        self.inc(4, n);
        self.changed.insert(id);
        if clear {
            self.cmd(10.0, &[id as f64]);
        }
    }
    fn read_defs(&mut self, r: &mut Read) {
        let n = r.u();
        for _ in 0..n {
            let id = r.u();
            let fare = r.f();
            let purpose = r.u();
            let nb = r.u();
            let byline = (0..nb).map(|_| (r.u(), r.f())).collect();
            let nl = r.u();
            let legs = (0..nl)
                .map(|_| Leg {
                    service: r.u(),
                    dir: r.f() as i32,
                    from: r.u(),
                    to: r.u(),
                    valid: r.f() != 0.0,
                })
                .collect();
            self.defs.insert(
                id,
                Journey {
                    fare,
                    purpose,
                    byline,
                    legs,
                },
            );
        }
    }
    fn read_trains(&mut self, r: &mut Read) {
        let n = r.u();
        for _ in 0..n {
            let id = r.u();
            let service = r.u();
            let parent = r.u();
            let capacity = r.f();
            let dir = r.f() as i32;
            let is_loop = r.f() != 0.0;
            let ns = r.u();
            let stops = (0..ns).map(|_| r.u()).collect();
            let nc = r.u();
            let calls = (0..nc).map(|_| r.u()).collect();
            let onboard = r.f();
            let np = r.u();
            let mut passengers = Ordered::new();
            for _ in 0..np {
                let t = r.tok();
                let amount = r.f();
                passengers.set(t, amount);
            }
            self.trains.insert(
                id,
                Cargo {
                    service,
                    parent,
                    capacity,
                    dir,
                    is_loop,
                    stops,
                    calls,
                    onboard,
                    passengers,
                },
            );
        }
    }
    fn load(&mut self, r: &mut Read) {
        for v in &mut self.counters {
            *v = r.f();
        }
        for kind in 0..3 {
            let n = r.u();
            for _ in 0..n {
                let id = r.u();
                let v = r.f();
                match kind {
                    0 => self.purposes.set(id, v),
                    1 => self.revenue.set(id, v),
                    _ => self.boarded.set(id, v),
                }
            }
        }
        let n = r.u();
        for _ in 0..n {
            let id = r.u();
            let v = r.f();
            self.occupancy.insert(id, v);
        }
        let n = r.u();
        for _ in 0..n {
            let id = r.u();
            let nc = r.u();
            let mut q = Ordered::new();
            for _ in 0..nc {
                let (t, c) = r.cohort();
                q.set(t, c);
            }
            self.outside.insert(id, q);
        }
        let n = r.u();
        for _ in 0..n {
            let k = (r.u(), r.f() as i32, r.u());
            let nc = r.u();
            for _ in 0..nc {
                let (t, c) = r.cohort();
                self.queue(k).set(t, c);
            }
            self.queue(k);
        }
        let n = r.u();
        for _ in 0..n {
            self.transfers.push(Transfer {
                j: r.u(),
                leg: r.u(),
                n: r.f(),
                ready: r.f(),
                _station: r.u(),
            });
        }
    }
}
#[no_mangle]
pub extern "C" fn queue_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn simulation_step() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core {
            input,
            output,
            simulation_state,
            queue_state,
            ..
        } = &mut *c;
        let mut r = Read { v: input, at: 0 };
        assert_eq!(r.f(), 1.0);
        let token = r.f();
        let phase = r.u();
        let load = r.u() != 0;
        let now = r.f();
        let modern = r.f() != 0.0;
        let integer = r.f() != 0.0;
        let transfer = r.f();
        let gates = r.f() != 0.0;
        let cursor = r.u();
        let original = r.f();
        let rerouted = r.f();
        let reroute_amount = r.f();
        let nm = r.u();
        let motion_input = &r.v[r.at..r.at + nm];
        r.at += nm;
        if load {
            *queue_state = Some(Queues::new(token));
        }
        let q = queue_state.as_mut().expect("queue state missing");
        assert_eq!(q.token, token);
        q.now = now;
        q.modern = modern;
        q.integer = integer;
        q.transfer = transfer;
        q.commands.clear();
        q.changed.clear();
        q.revenue_delta.clear();
        q.boarded_delta.clear();
        q.purpose_delta.clear();
        q.dirty = 0;
        q.read_defs(&mut r);
        let nl = r.u();
        for _ in 0..nl {
            let id = r.u();
            let a = r.f();
            let b = r.f();
            q.limits.insert(id, (a, b));
        }
        q.read_trains(&mut r);
        if load {
            q.load(&mut r);
        }
        let norder = r.u();
        let order = (0..norder).map(|_| r.u()).collect::<Vec<_>>();
        let nop = r.u();
        let mut ops = (0..nop)
            .map(|_| [r.f(), r.f(), r.f(), r.f()])
            .collect::<Vec<_>>();
        let na = r.u();
        let arrivals = (0..na).map(|_| [r.f(), r.f(), r.f()]).collect::<Vec<_>>();
        assert_eq!(r.at, input.len());
        let motion = if phase == 0 {
            crate::simulation::motion_packet(motion_input, simulation_state)
        } else {
            vec![]
        };
        if phase == 0 {
            q.release();
            if gates {
                q.gates();
            }
            for a in arrivals {
                if a[2] <= 0.0 {
                    continue;
                }
                q.inc(0, a[2]);
                q.event(0, int(a[1]), a[2], 0.0, None, None);
                if a[0] < 0.0 {
                    q.inc(4, a[2]);
                } else {
                    q.admit(int(a[0]), 0, a[2], false);
                }
            }
            for (&id, row) in order.iter().zip(motion.chunks_exact(8)) {
                let action = row[0] as u8;
                let cargo = &q.trains[&id];
                match action {
                    1 => ops.push([3.0, id as f64, 0.0, 0.0]),
                    2..=5 => {
                        ops.push([0.0, id as f64, row[2], row[3]]);
                        if action >= 3 && cargo.calls.contains(&cargo.stops[int(row[4])]) {
                            ops.push([1.0, id as f64, cargo.stops[int(row[4])] as f64, 0.0]);
                        }
                        if action == 5 {
                            ops.push([3.0, id as f64, 1.0, 0.0]);
                        }
                    }
                    7 => ops.push([2.0, id as f64, cargo.stops[int(row[4])] as f64, row[4]]),
                    _ => {}
                }
            }
        } else if original >= 0.0 {
            if rerouted >= 0.0 {
                q.admit(int(rerouted), 0, reroute_amount, true);
            } else {
                q.reject(int(original), reroute_amount);
            }
        }
        let mut request = None;
        let mut at = cursor;
        while at < ops.len() {
            let op = ops[at];
            let id = int(op[1]);
            match op[0] as u8 {
                0 => {
                    if op[2] > 0.0 {
                        q.cmd(2.0, &[id as f64, op[2], q.trains[&id].onboard]);
                    }
                    q.inc(7, op[3]);
                }
                1 => {
                    if let Some(p) = q.unload(id, int(op[2])) {
                        request = Some(p);
                        break;
                    }
                }
                2 => q.board(id, int(op[2]), int(op[3])),
                3 => q.finish(id, op[2] != 0.0),
                _ => panic!("queue operation"),
            }
            at += 1;
        }
        let changed = q.changed.iter().copied().collect::<Vec<_>>();
        for id in changed {
            q.cmd(9.0, &[id as f64, q.trains[&id].onboard]);
        }
        for id in q.revenue_delta.keys() {
            q.cmd(13.0, &[id as f64, q.revenue_delta.get(id).unwrap()]);
        }
        for id in q.boarded_delta.keys() {
            q.cmd(14.0, &[id as f64, q.boarded_delta.get(id).unwrap()]);
        }
        for id in q.purpose_delta.keys() {
            q.cmd(15.0, &[id as f64, q.purpose_delta.get(id).unwrap()]);
        }
        let pending = request.is_some();
        let (j, station, amount) =
            request.map_or((-1.0, -1.0, 0.0), |(j, s, n)| (j as f64, s as f64, n));
        *output = vec![
            1.0,
            if pending { 1.0 } else { 0.0 },
            at as f64,
            j,
            station,
            amount,
            motion.len() as f64,
            if pending { ops.len() as f64 } else { 0.0 },
            q.dirty as f64,
        ];
        output.extend(q.counters);
        output.extend(motion);
        if pending {
            for op in ops {
                output.extend(op);
            }
        }
        output.extend_from_slice(&q.commands);
        let alive = order.into_iter().collect::<HashSet<_>>();
        q.trains.retain(|id, _| alive.contains(id));
        output.as_ptr()
    })
}

#[cfg(test)]
mod tests {
    use super::Ordered;
    #[test]
    fn ordered_delete_reinsert_and_compaction() {
        let mut q = Ordered::new();
        for k in 0..200 {
            q.set(k, k as f64);
        }
        q.set(5, 500.0);
        assert_eq!(q.keys()[5], 5);
        for k in 0..160 {
            q.remove(k);
        }
        q.set(5, 1.0);
        let mut expected = (160..200).collect::<Vec<_>>();
        expected.push(5);
        assert_eq!(q.keys(), expected);
        assert_eq!(q.get(5), Some(1.0));
        assert_eq!(q.get(159), None);
        assert!(q.rows.len() <= q.index.len() * 2 + 64);
    }
}
