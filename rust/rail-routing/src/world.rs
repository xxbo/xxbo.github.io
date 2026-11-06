//! Whole-forecast ownership: spatial sampling, hubs, grouping, native routing and allocation.
use crate::demand::{distribution, exp, hypot, max, min, mode_value, strategy};
use crate::{int, search, Graph, CORE};
use std::collections::{BTreeMap, HashMap};
use std::hash::Hash;
use std::rc::Rc;
const W: f64 = 1.0 / 16.0;
const RATES: [f64; 3] = [0.52, 0.16, 0.12];
const VOT: [f64; 3] = [40.0, 25.0, 20.0];
const FIELDS: [usize; 3] = [1, 2, 4];
struct Read<'a> {
    v: &'a [f64],
    at: usize,
}
impl<'a> Read<'a> {
    fn f(&mut self) -> f64 {
        let v = self.v[self.at];
        self.at += 1;
        v
    }
    fn u(&mut self) -> usize {
        int(self.f())
    }
}
#[derive(Clone, Default)]
struct Point {
    x: f64,
    y: f64,
}
fn distance(a: &Point, b: &Point) -> f64 {
    hypot(a.x - b.x, a.y - b.y) * 0.045
}
#[derive(Clone)]
struct Cell {
    p: Point,
    w: f64,
    h: f64,
    area: f64,
    values: [f64; 5],
    factory: f64,
    survey: f64,
    pop_valid: bool,
}
fn cell(r: &mut Read) -> Cell {
    Cell {
        p: Point { x: r.f(), y: r.f() },
        w: r.f(),
        h: r.f(),
        area: r.f(),
        values: [r.f(), r.f(), r.f(), r.f(), r.f()],
        factory: r.f(),
        survey: r.f(),
        pop_valid: r.f() != 0.0,
    }
}
#[derive(Clone)]
struct Hub {
    p: Point,
    _movements: f64,
    _landside: f64,
    arrivals: f64,
    returns: f64,
    local_depart: f64,
    _local_return: f64,
    staff: f64,
    reference: f64,
}
#[derive(Clone)]
struct Zone {
    bin: (i64, i64),
    p: Point,
    count: usize,
    area: f64,
    values: [f64; 5],
    cells: Vec<usize>,
}
pub(super) struct Prepared {
    token: f64,
    zones: Vec<Zone>,
    matrices: Vec<f64>,
    budgets: [[f64; 3]; 3],
}
struct World {
    token: f64,
    effective: bool,
    urban: bool,
    version: f64,
    step: f64,
    zone_size: f64,
    capture: f64,
    market_scale: f64,
    totals: [f64; 5],
    nodes: Vec<Point>,
    ids: Vec<usize>,
    cells: Vec<Cell>,
    hubs: Vec<Hub>,
    runs: Vec<(f64, f64, Vec<usize>)>,
    track_count: usize,
    edge_tracks: Vec<Vec<usize>>,
    services: usize,
}
impl World {
    fn parse(v: &[f64]) -> Self {
        let mut r = Read { v, at: 0 };
        assert_eq!(r.f(), 1.0);
        let (token, effective, urban, version, step, zone_size, capture, market_scale) = (
            r.f(),
            r.f() != 0.0,
            r.f() != 0.0,
            r.f(),
            r.f(),
            r.f(),
            r.f(),
            r.f(),
        );
        let totals = [r.f(), r.f(), r.f(), r.f(), r.f()];
        let (nn, ni, nc, nh, nr, nt, ne, services) =
            (r.u(), r.u(), r.u(), r.u(), r.u(), r.u(), r.u(), r.u());
        let nodes = (0..nn)
            .map(|_| Point { x: r.f(), y: r.f() })
            .collect::<Vec<_>>();
        let ids = (0..ni)
            .map(|_| {
                let id = r.u();
                assert!(id < nn);
                id
            })
            .collect();
        let cells = (0..nc).map(|_| cell(&mut r)).collect();
        let hubs = (0..nh)
            .map(|_| Hub {
                p: Point { x: r.f(), y: r.f() },
                _movements: r.f(),
                _landside: r.f(),
                arrivals: r.f(),
                returns: r.f(),
                local_depart: r.f(),
                _local_return: r.f(),
                staff: r.f(),
                reference: r.f(),
            })
            .collect();
        let runs = (0..nr)
            .map(|_| {
                let headway = r.f();
                let cap = r.f();
                let n = r.u();
                let ids = (0..n)
                    .map(|_| {
                        let id = r.u();
                        assert!(id < nt);
                        id
                    })
                    .collect();
                (headway, cap, ids)
            })
            .collect();
        let edge_tracks = (0..ne)
            .map(|_| {
                let n = r.u();
                (0..n)
                    .map(|_| {
                        let id = r.u();
                        assert!(id < nt);
                        id
                    })
                    .collect()
            })
            .collect();
        assert_eq!(r.at, v.len());
        Self {
            token,
            effective,
            urban,
            version,
            step,
            zone_size,
            capture,
            market_scale,
            totals,
            nodes,
            ids,
            cells,
            hubs,
            runs,
            track_count: nt,
            edge_tracks,
            services,
        }
    }
    fn prepared(&self, cache: &mut Option<Rc<Prepared>>) -> Rc<Prepared> {
        if let Some(p) = cache {
            if p.token == self.token {
                return Rc::clone(p);
            }
        }
        let mut zones: Vec<Zone> = vec![];
        let mut bins = HashMap::new();
        for (i, c) in self.cells.iter().enumerate() {
            let bin = (
                (c.p.x / self.zone_size).floor() as i64,
                (c.p.y / self.zone_size).floor() as i64,
            );
            let index = if let Some(&index) = bins.get(&bin) {
                index
            } else {
                let index = zones.len();
                bins.insert(bin, index);
                zones.push(Zone {
                    bin,
                    p: Point::default(),
                    count: 0,
                    area: 0.0,
                    values: [0.0; 5],
                    cells: vec![],
                });
                index
            };
            let z = &mut zones[index];
            z.p.x += c.p.x;
            z.p.y += c.p.y;
            z.count += 1;
            z.area += c.area;
            for k in 0..5 {
                z.values[k] += c.values[k];
            }
            z.cells.push(i);
        }
        for z in &mut zones {
            z.p.x /= z.count as f64;
            z.p.y /= z.count as f64;
        }
        let budgets = activity_budgets(&self.totals);
        let mut input = vec![
            zones.len() as f64,
            if self.effective { 1.0 } else { 0.0 },
            self.totals[0],
        ];
        for p in 0..3 {
            input.push(if self.effective {
                budgets[p][2]
            } else {
                self.totals[0] * RATES[p]
            });
        }
        for z in &zones {
            input.extend_from_slice(&[
                z.p.x,
                z.p.y,
                z.area,
                z.values[0],
                z.values[1],
                z.values[2],
                z.values[3],
                z.values[4],
            ]);
        }
        let prepared = Rc::new(Prepared {
            token: self.token,
            zones,
            matrices: distribution(&input),
            budgets,
        });
        *cache = Some(Rc::clone(&prepared));
        prepared
    }
}
fn activity_budgets(totals: &[f64; 5]) -> [[f64; 3]; 3] {
    std::array::from_fn(|p| {
        let nominal = max(0.0, totals[0] * RATES[p]);
        let capacity = max(0.0, totals[FIELDS[p]] * [0.95, 1.8, 1.5][p]);
        [nominal, capacity, min(nominal, capacity)]
    })
}
#[derive(Clone, Default)]
struct Access {
    id: usize,
    mode: usize,
    share: f64,
    km: f64,
    time: f64,
    cost: f64,
    weight: f64,
    p: Point,
}
fn choices(p: &Point, stations: &[(usize, Point)], feeders: bool) -> Vec<Access> {
    let mut out = vec![];
    for (id, n) in stations {
        let km = distance(p, n) * 1.25;
        let (time, mode, availability) = if km <= 0.8 {
            (km / 4.8 * 60.0, 0, 1.0)
        } else if feeders && km <= 2.5 {
            (4.0 + km / 12.0 * 60.0, 1, 0.3)
        } else if feeders && km <= 4.0 {
            (7.0 + km / 16.0 * 60.0, 2, 0.25)
        } else {
            continue;
        };
        out.push(Access {
            id: *id,
            km,
            time,
            mode,
            cost: time * [1.7, 1.2, 1.1][mode],
            weight: exp(-0.14 * time) * availability,
            ..Access::default()
        });
    }
    out.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(3);
    let sum = out.iter().fold(0.0, |n, a| n + a.weight);
    for a in &mut out {
        a.share = a.weight / sum;
    }
    out
}
struct Index {
    bins: HashMap<(i64, i64), Vec<(usize, Point)>>,
}
impl Index {
    fn new(w: &World) -> Self {
        let mut bins: HashMap<_, Vec<_>> = HashMap::new();
        for &id in &w.ids {
            let n = &w.nodes[id];
            bins.entry(((n.x / 100.0).floor() as i64, (n.y / 100.0).floor() as i64))
                .or_default()
                .push((id, n.clone()));
        }
        Self { bins }
    }
    fn near(&self, p: &Point) -> Vec<(usize, Point)> {
        let x = (p.x / 100.0).floor() as i64;
        let y = (p.y / 100.0).floor() as i64;
        let mut out = vec![];
        for a in x - 1..=x + 1 {
            for b in y - 1..=y + 1 {
                if let Some(list) = self.bins.get(&(a, b)) {
                    out.extend_from_slice(list);
                }
            }
        }
        out
    }
}
#[derive(Clone, Default)]
struct Station {
    values: [f64; 5],
    walk: f64,
    cells: f64,
}
struct Mapping {
    index: usize,
    id: usize,
    walk: f64,
    access: Vec<Access>,
}
struct Catchment {
    stations: Vec<Station>,
    mapping: Vec<Mapping>,
    covered: f64,
    accessible: f64,
}
fn assign(w: &World, idx: &Index) -> Catchment {
    let mut out = Catchment {
        stations: vec![Station::default(); w.nodes.len()],
        mapping: vec![],
        covered: 0.0,
        accessible: 0.0,
    };
    for (ci, c) in w.cells.iter().enumerate() {
        let near = idx.near(&c.p);
        if near.is_empty() {
            continue;
        }
        let mut totals: Vec<Access> = vec![];
        let mut keys: HashMap<(usize, usize, i64), usize> = HashMap::new();
        for y in 0..4 {
            for x in 0..4 {
                let p = Point {
                    x: c.p.x + ((x as f64 + 0.5) / 4.0 - 0.5) * c.w,
                    y: c.p.y + ((y as f64 + 0.5) / 4.0 - 0.5) * c.h,
                };
                for a in choices(&p, &near, true) {
                    let key = (a.id, a.mode, (a.time / 3.0).floor() as i64);
                    let at = if let Some(&at) = keys.get(&key) {
                        at
                    } else {
                        let at = totals.len();
                        keys.insert(key, at);
                        totals.push(Access {
                            id: a.id,
                            mode: a.mode,
                            ..Access::default()
                        });
                        at
                    };
                    let t = &mut totals[at];
                    t.p.x += p.x * a.share * W;
                    t.p.y += p.y * a.share * W;
                    t.share += a.share * W;
                    t.km += a.km * a.share * W;
                    t.time += a.time * a.share * W;
                    t.cost += a.cost * a.share * W;
                }
                let foot = choices(&p, &near, false);
                out.covered += c.values[0] * W * foot.iter().fold(0.0, |n, a| n + a.share);
                for a in foot {
                    let st = &mut out.stations[a.id];
                    for k in 0..5 {
                        st.values[k] += c.values[k] * a.share * W;
                    }
                    st.walk += a.km * c.values[0] * a.share * W;
                    st.cells += a.share * W;
                }
            }
        }
        if totals.is_empty() {
            continue;
        }
        for a in &mut totals {
            a.km /= a.share;
            a.time /= a.share;
            a.cost /= a.share;
            a.p.x /= a.share;
            a.p.y /= a.share;
        }
        let mut id = 0;
        for i in 1..totals.len() {
            if !(totals[id].share > totals[i].share) {
                id = i;
            }
        }
        let walk = totals.iter().fold(0.0, |n, a| n + a.km * a.share);
        out.accessible += c.values[0] * totals.iter().fold(0.0, |n, a| n + a.share);
        out.mapping.push(Mapping {
            index: ci,
            id: totals[id].id,
            walk,
            access: totals,
        });
    }
    for st in &mut out.stations {
        st.walk = if st.values[0] != 0.0 {
            st.walk / st.values[0]
        } else {
            0.0
        };
    }
    out
}
fn write_catchment(out: &mut Vec<f64>, w: &World, c: &Catchment) {
    out.extend_from_slice(&[c.covered, c.accessible, w.totals[0], w.ids.len() as f64]);
    for &id in &w.ids {
        let st = &c.stations[id];
        out.push(id as f64);
        out.extend(st.values);
        out.extend_from_slice(&[st.walk, st.cells]);
    }
    out.push(c.mapping.len() as f64);
    for m in &c.mapping {
        out.extend_from_slice(&[m.index as f64, m.id as f64, m.walk, m.access.len() as f64]);
        for a in &m.access {
            out.extend_from_slice(&[
                a.id as f64,
                a.mode as f64,
                a.share,
                a.km,
                a.time,
                a.cost,
                a.p.x,
                a.p.y,
            ]);
        }
    }
}
#[derive(Clone, Default)]
struct ZoneAccess {
    id: usize,
    _mode: usize,
    mass: f64,
    time: f64,
    cost: f64,
    p: Point,
    share: f64,
}
fn zone_access(w: &World, p: &Prepared, c: &Catchment) -> (Vec<[Vec<ZoneAccess>; 5]>, Vec<usize>) {
    let mapping: HashMap<usize, &Mapping> = c.mapping.iter().map(|m| (m.index, m)).collect();
    let mut out = vec![];
    let mut active = vec![];
    for (zi, z) in p.zones.iter().enumerate() {
        let mut maps: [HashMap<(usize, usize, i64), usize>; 5] =
            std::array::from_fn(|_| HashMap::new());
        let mut fields: [Vec<ZoneAccess>; 5] = std::array::from_fn(|_| vec![]);
        for &ci in &z.cells {
            if let Some(m) = mapping.get(&ci) {
                for a in &m.access {
                    for k in 0..5 {
                        let key = (a.id, a.mode, (a.time / 3.0).floor() as i64);
                        let at = if let Some(&at) = maps[k].get(&key) {
                            at
                        } else {
                            let at = fields[k].len();
                            maps[k].insert(key, at);
                            fields[k].push(ZoneAccess {
                                id: a.id,
                                _mode: a.mode,
                                ..ZoneAccess::default()
                            });
                            at
                        };
                        let mass = w.cells[ci].values[k] * a.share;
                        let g = &mut fields[k][at];
                        g.mass += mass;
                        g.time += mass * a.time;
                        g.cost += mass * a.cost;
                        g.p.x += mass * a.p.x;
                        g.p.y += mass * a.p.y;
                    }
                }
            }
        }
        for k in 0..5 {
            fields[k].retain(|a| a.mass > 0.0);
            for a in &mut fields[k] {
                a.share = a.mass / max(1.0, z.values[k]);
                a.time /= a.mass;
                a.cost /= a.mass;
                a.p.x /= a.mass;
                a.p.y /= a.mass;
            }
        }
        if !fields[0].is_empty()
            || !fields[1].is_empty()
            || !fields[2].is_empty()
            || !fields[4].is_empty()
        {
            active.push(zi);
        }
        out.push(fields);
    }
    (out, active)
}
#[derive(Clone)]
struct Stop {
    id: usize,
    share: f64,
    time: f64,
    cost: f64,
    _p: Point,
}
impl From<&Access> for Stop {
    fn from(a: &Access) -> Self {
        Self {
            id: a.id,
            share: a.share,
            time: a.time,
            cost: a.cost,
            _p: a.p.clone(),
        }
    }
}
impl From<&ZoneAccess> for Stop {
    fn from(a: &ZoneAccess) -> Self {
        Self {
            id: a.id,
            share: a.share,
            time: a.time,
            cost: a.cost,
            _p: a.p.clone(),
        }
    }
}
#[derive(Clone)]
struct HubAllocation {
    activation: f64,
    arrivals: f64,
    returns: f64,
    local: Vec<f64>,
    staff: Vec<f64>,
    visitor: Vec<f64>,
    connections: Vec<Access>,
    capture: f64,
    mass: f64,
    development: f64,
    riders: f64,
    arrived: f64,
    departed: f64,
    staff_riders: f64,
    passenger_riders: f64,
}
#[derive(Clone)]
struct Group {
    from: usize,
    to: usize,
    purpose: usize,
    back: bool,
    people: f64,
    access: f64,
    cost: f64,
    km: f64,
    hub: Option<usize>,
    kind: Option<usize>,
}
type GroupKey = (
    usize,
    usize,
    usize,
    bool,
    Option<usize>,
    Option<usize>,
    i64,
    i64,
);
struct Groups {
    values: Vec<Group>,
    keys: HashMap<GroupKey, usize>,
    component: Vec<usize>,
}
impl Groups {
    fn add(
        &mut self,
        a: &Stop,
        b: &Stop,
        purpose: usize,
        back: bool,
        daily: f64,
        km: f64,
        hub: Option<usize>,
        kind: Option<usize>,
    ) {
        if self.component[a.id] != self.component[b.id] || a.id == b.id || daily < 1e-10 {
            return;
        }
        let key = (
            a.id,
            b.id,
            purpose,
            back,
            hub,
            kind,
            ((a.time + b.time) / 3.0).floor() as i64,
            (km / 2.0).floor() as i64,
        );
        let at = if let Some(&at) = self.keys.get(&key) {
            at
        } else {
            let at = self.values.len();
            self.keys.insert(key, at);
            self.values.push(Group {
                from: a.id,
                to: b.id,
                purpose,
                back,
                people: 0.0,
                access: 0.0,
                cost: 0.0,
                km: 0.0,
                hub,
                kind,
            });
            at
        };
        let amount = daily * a.share * b.share;
        let g = &mut self.values[at];
        g.people += amount;
        g.access += amount * (a.time + b.time);
        g.cost += amount * (a.cost + b.cost);
        g.km += amount * km;
    }
}
fn root(component: &mut [usize], mut i: usize) -> usize {
    while component[i] != i {
        component[i] = component[component[i]];
        i = component[i];
    }
    i
}
fn components(graph: &Graph) -> Vec<usize> {
    let mut c: Vec<usize> = (0..graph.adj.len()).collect();
    for i in 0..graph.adj.len() {
        for &e in &graph.adj[i] {
            let to = root(&mut c, graph.edges[e].to);
            let from = root(&mut c, i);
            c[to] = from;
        }
    }
    (0..c.len()).map(|i| root(&mut c, i)).collect()
}
fn hub_groups(
    w: &World,
    p: &Prepared,
    c: &Catchment,
    idx: &Index,
    graph: &Graph,
) -> (Groups, Vec<HubAllocation>, [f64; 2]) {
    let n = p.zones.len();
    let (access, active) = zone_access(w, p, c);
    let mut staff_budget = vec![0.0; n];
    let mut local_budget = vec![0.0; n];
    let mut allocations = vec![];
    for h in &w.hubs {
        let market = p.zones.iter().fold(0.0, |v, z| {
            v + (z.values[0] + z.values[1] * 0.7) * exp(-distance(&z.p, &h.p) / 35.0)
        });
        let activation = if w.urban {
            (1.0 - crate::demand::raw_exp(-market / 40000.0))
                * (0.2 + 0.8 * (1.0 - crate::demand::raw_exp(-w.step / 32.0)))
        } else {
            1.0
        };
        let arrivals = h.arrivals * activation;
        let returns = h.returns * activation;
        let departures = h.local_depart * activation;
        let visitor: Vec<f64> = p
            .zones
            .iter()
            .map(|z| (z.values[1] * 0.35 + z.values[4]) * exp(-distance(&z.p, &h.p) / 35.0))
            .collect();
        let residents: Vec<f64> = p
            .zones
            .iter()
            .map(|z| z.values[0] * exp(-distance(&z.p, &h.p) / 45.0))
            .collect();
        let vs = visitor.iter().fold(0.0, |a, b| a + b);
        let rs = residents.iter().fold(0.0, |a, b| a + b);
        let local: Vec<f64> = residents
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let q = if rs != 0.0 { departures * a / rs } else { 0.0 };
                local_budget[i] += q;
                q
            })
            .collect();
        let staff: Vec<f64> = p
            .zones
            .iter()
            .map(|z| z.values[0] * exp(-distance(&z.p, &h.p) / 30.0))
            .collect();
        let ss = staff.iter().fold(0.0, |a, b| a + b);
        let staff: Vec<f64> = staff
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let trips = if ss != 0.0 {
                    h.staff * 0.8 * v / ss
                } else {
                    0.0
                };
                staff_budget[i] += trips;
                trips
            })
            .collect();
        let mut connections = choices(&h.p, &idx.near(&h.p), false);
        for a in &mut connections {
            a.p = h.p.clone();
        }
        allocations.push(HubAllocation {
            activation,
            arrivals,
            returns,
            local,
            staff,
            visitor: visitor
                .iter()
                .map(|a| if vs != 0.0 { a / vs } else { 0.0 })
                .collect(),
            connections,
            capture: 0.0,
            mass: 0.0,
            development: 0.0,
            riders: 0.0,
            arrived: 0.0,
            departed: 0.0,
            staff_riders: 0.0,
            passenger_riders: 0.0,
        });
    }
    let mut visitor_budget = [1.0, 0.0];
    if w.effective {
        let total = allocations.iter().fold(0.0, |v, a| v + a.arrivals);
        let capacity = max(
            0.0,
            w.totals[2] * 0.8 + w.totals[4] * 0.65 + w.totals[1] * 0.12,
        );
        let scale = if total > 0.0 {
            min(1.0, capacity / total)
        } else {
            1.0
        };
        visitor_budget = [scale, capacity];
        for a in &mut allocations {
            a.arrivals *= scale;
            a.returns *= scale;
        }
    }
    let component = components(graph);
    if w.effective {
        let mut staff = vec![0.0; n];
        let mut local = vec![0.0; n];
        for a in &mut allocations {
            for i in 0..n {
                let reachable = access[i][0].iter().any(|o| {
                    a.connections
                        .iter()
                        .any(|d| o.id != d.id && component[o.id] == component[d.id])
                });
                if !reachable {
                    a.staff[i] = 0.0;
                    a.local[i] = 0.0;
                }
                staff[i] += a.staff[i];
                local[i] += a.local[i];
            }
        }
        for a in &mut allocations {
            for i in 0..n {
                a.staff[i] *= if staff[i] != 0.0 {
                    min(1.0, p.zones[i].values[0] * 0.52 * 0.25 / staff[i])
                } else {
                    0.0
                };
                a.local[i] *= if local[i] != 0.0 {
                    min(1.0, p.zones[i].values[0] * 0.12 * 0.25 / local[i])
                } else {
                    0.0
                };
            }
        }
        staff_budget.fill(0.0);
        local_budget.fill(0.0);
        for a in &allocations {
            for i in 0..n {
                staff_budget[i] += a.staff[i];
                local_budget[i] += a.local[i];
            }
        }
    }
    let mut groups = Groups {
        values: vec![],
        keys: HashMap::new(),
        component,
    };
    for &i in &active {
        for &j in &active {
            for purpose in 0..3 {
                let mut daily = p.matrices[5 + purpose * n * n + i * n + j];
                if purpose == 0 {
                    daily *= max(
                        0.0,
                        1.0 - staff_budget[i] / max(1.0, p.zones[i].values[0] * 0.52),
                    );
                }
                if purpose == 2 {
                    daily *= max(
                        0.0,
                        1.0 - local_budget[i] / max(1.0, p.zones[i].values[0] * 0.12),
                    );
                }
                if daily == 0.0 {
                    continue;
                }
                for a in &access[i][0] {
                    for b in &access[j][FIELDS[purpose]] {
                        let direct = distance(&a.p, &b.p);
                        let a = Stop::from(a);
                        let b = Stop::from(b);
                        groups.add(&a, &b, purpose, false, daily, direct, None, None);
                        groups.add(&b, &a, purpose, true, daily, direct, None, None);
                    }
                }
            }
        }
    }
    let mut station_ids = w.ids.clone();
    station_ids.sort_unstable();
    for (hi, a) in allocations.iter_mut().enumerate() {
        let h = &w.hubs[hi];
        let mut targets: Vec<(Stop, f64, f64)> = vec![];
        let mut mass = 0.0;
        let mut weight_sum = 0.0;
        for &id in &station_ids {
            if a.connections.iter().any(|c| c.id == id)
                || !a
                    .connections
                    .iter()
                    .any(|c| groups.component[c.id] == groups.component[id])
            {
                continue;
            }
            let st = &c.stations[id];
            let km = distance(&w.nodes[id], &h.p);
            let usefulness = 1.0 - crate::demand::raw_exp(-km / 2.5);
            let m = if w.effective {
                st.values[1] * 0.35 + st.values[2] * 0.8 + st.values[4]
            } else {
                st.values[0] + st.values[1] * 0.6
            } * usefulness;
            if m <= 0.0 {
                continue;
            }
            let weight = if w.effective {
                st.values[1] * 0.35 + st.values[2] * 0.8 + st.values[4]
            } else {
                st.values[0] * 0.3 + st.values[1] * 0.65 + st.values[4]
            } * crate::demand::raw_exp(-km / 45.0)
                * usefulness;
            let time = st.walk / 4.8 * 60.0;
            targets.push((
                Stop {
                    id,
                    share: 1.0,
                    time,
                    cost: 1.7 * time,
                    _p: Point::default(),
                },
                weight,
                km,
            ));
            mass += m;
        }
        for (t, weight, _) in &targets {
            for hst in &a.connections {
                if groups.component[t.id] == groups.component[hst.id] {
                    weight_sum += weight * hst.share;
                }
            }
        }
        let capture = if weight_sum > 0.0 {
            (if w.version == 19.0 { 0.90 } else { w.capture })
                * (1.0
                    - crate::demand::raw_exp(
                        -mass
                            / if w.version == 19.0 {
                                14000.0
                            } else {
                                w.market_scale
                            },
                    ))
        } else {
            0.0
        };
        a.capture = capture;
        a.mass = mass;
        a.development = if w.urban {
            1.0 - crate::demand::raw_exp(-mass / 14000.0)
        } else {
            1.0
        };
        for (t, weight, km) in &targets {
            for connection in &a.connections {
                if groups.component[t.id] != groups.component[connection.id] || capture == 0.0 {
                    continue;
                }
                let daily = a.arrivals * capture * weight * connection.share / weight_sum;
                let mut hst = Stop::from(connection);
                hst.share = 1.0;
                groups.add(&hst, t, 2, false, daily, *km, Some(hi), Some(0));
                groups.add(t, &hst, 2, true, daily, *km, Some(hi), Some(1));
            }
        }
        for &i in &active {
            let km = distance(&p.zones[i].p, &h.p);
            for connection in &a.connections {
                let hst = Stop::from(connection);
                for o in &access[i][4] {
                    let daily = a.arrivals * (1.0 - capture) * a.visitor[i];
                    let o = Stop::from(o);
                    groups.add(&hst, &o, 2, false, daily, km, Some(hi), Some(0));
                    groups.add(&o, &hst, 2, true, daily, km, Some(hi), Some(1));
                }
                for o in &access[i][0] {
                    let o = Stop::from(o);
                    let employees = a.staff[i]
                        * min(1.0, p.zones[i].values[0] * 0.52 / max(1.0, staff_budget[i]));
                    if employees != 0.0 {
                        groups.add(&o, &hst, 0, false, employees, km, Some(hi), Some(2));
                        groups.add(&hst, &o, 0, true, employees, km, Some(hi), Some(3));
                    }
                    let cap = if local_budget[i] > p.zones[i].values[0] * 0.12 {
                        p.zones[i].values[0] * 0.12 / local_budget[i]
                    } else {
                        1.0
                    };
                    let daily = a.local[i] * cap;
                    groups.add(&o, &hst, 2, false, daily, km, Some(hi), Some(4));
                    groups.add(&hst, &o, 2, true, daily, km, Some(hi), Some(5));
                }
            }
        }
    }
    (groups, allocations, visitor_budget)
}
#[derive(Default)]
struct CacheStats {
    hits: usize,
    misses: usize,
    evictions: usize,
    peak: usize,
    weight: usize,
    peak_weight: usize,
    oversized: usize,
}
struct Lru<K, V> {
    map: HashMap<K, (Rc<V>, u64, usize)>,
    order: BTreeMap<u64, K>,
    clock: u64,
    limit: usize,
    budget: usize,
    stats: CacheStats,
}
impl<K: Eq + Hash + Clone, V> Lru<K, V> {
    fn new(limit: usize, budget: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: BTreeMap::new(),
            clock: 0,
            limit,
            budget,
            stats: CacheStats::default(),
        }
    }
    fn get(&mut self, key: &K) -> Option<Rc<V>> {
        self.clock += 1;
        if let Some(row) = self.map.get_mut(key) {
            self.stats.hits += 1;
            self.order.remove(&row.1);
            row.1 = self.clock;
            self.order.insert(self.clock, key.clone());
            Some(Rc::clone(&row.0))
        } else {
            self.stats.misses += 1;
            None
        }
    }
    fn set(&mut self, key: K, value: V, weight: usize) -> Rc<V> {
        let value = Rc::new(value);
        if let Some(row) = self.map.remove(&key) {
            self.stats.weight -= row.2;
            self.order.remove(&row.1);
        }
        if weight > self.budget {
            self.stats.oversized += 1;
            return value;
        }
        self.clock += 1;
        self.order.insert(self.clock, key.clone());
        self.map
            .insert(key, (Rc::clone(&value), self.clock, weight));
        self.stats.weight += weight;
        while self.map.len() > self.limit || self.stats.weight > self.budget {
            let (_, key) = self.order.pop_first().unwrap();
            self.stats.weight -= self.map.remove(&key).unwrap().2;
            self.stats.evictions += 1;
        }
        self.stats.peak = self.stats.peak.max(self.map.len());
        self.stats.peak_weight = self.stats.peak_weight.max(self.stats.weight);
        value
    }
    fn write(&self, out: &mut Vec<f64>) {
        out.extend_from_slice(&[
            self.map.len() as f64,
            self.limit as f64,
            self.stats.peak as f64,
            self.stats.hits as f64,
            self.stats.misses as f64,
            self.stats.evictions as f64,
            self.stats.weight as f64,
            if self.budget == usize::MAX {
                f64::INFINITY
            } else {
                self.budget as f64
            },
            self.stats.peak_weight as f64,
            self.stats.oversized as f64,
        ]);
    }
}
#[derive(Clone)]
struct Path {
    row: [f64; 14],
    edges: Vec<usize>,
    fares: Vec<(usize, f64)>,
}
fn path_at(tree: &[f64], to: usize) -> Option<Path> {
    if to >= int(tree[1]) {
        return None;
    }
    let at = 8 + to * 14;
    if tree[at] < 0.0 {
        return None;
    }
    let mut row = [0.0; 14];
    row.copy_from_slice(&tree[at..at + 14]);
    let mut trail = int(row[11]);
    let trail_offset = int(tree[5]);
    let mut edges = vec![];
    while tree[trail_offset + trail * 2] >= 0.0 {
        edges.push(int(tree[trail_offset + trail * 2 + 1]));
        trail = int(tree[trail_offset + trail * 2]);
    }
    edges.reverse();
    let fares = (0..int(row[13]))
        .map(|i| {
            let at = int(row[12]) + i * 2;
            (int(tree[at]), tree[at + 1])
        })
        .collect();
    Some(Path { row, edges, fares })
}
#[derive(Clone)]
struct Route {
    path: Rc<Path>,
    share: f64,
}
struct Strategy {
    expected: f64,
    wait: f64,
    routes: Vec<Route>,
}
struct Routing<'a> {
    graph: &'a Graph,
    trees: Lru<(usize, usize, u64), Vec<Vec<f64>>>,
    strategies: Lru<(usize, usize, usize, u64), Strategy>,
    searches: usize,
}
impl<'a> Routing<'a> {
    fn new(graph: &'a Graph) -> Self {
        Self {
            graph,
            trees: Lru::new(24, 60000),
            strategies: Lru::new(1024, usize::MAX),
            searches: 0,
        }
    }
    fn get(&mut self, from: usize, to: usize, purpose: usize, value: f64) -> Rc<Strategy> {
        let key = (from, to, purpose, value.to_bits());
        if let Some(s) = self.strategies.get(&key) {
            return s;
        }
        let origin = (from, purpose, value.to_bits());
        let trees = if let Some(t) = self.trees.get(&origin) {
            t
        } else {
            let mut first = vec![];
            for &ix in &self.graph.adj[from] {
                let group = self.graph.edges[ix].group;
                if !first.contains(&group) {
                    first.push(group);
                }
            }
            let trees: Vec<Vec<f64>> = first
                .iter()
                .map(|group| {
                    self.searches += 1;
                    search(self.graph, from, 1.0 / value, *group)
                })
                .collect();
            let weight = trees.iter().map(|t| int(t[2])).sum();
            self.trees.set(origin, trees, weight)
        };
        let candidates: Vec<Rc<Path>> = trees
            .iter()
            .filter_map(|tree| path_at(tree, to))
            .filter(|p| !p.edges.is_empty())
            .map(Rc::new)
            .collect();
        let mut input = vec![candidates.len() as f64, value];
        for (i, p) in candidates.iter().enumerate() {
            let first = &self.graph.edges[p.edges[0]];
            input.extend_from_slice(&[
                first.group as f64,
                p.row[7],
                p.row[8],
                first.headway,
                i as f64,
            ]);
        }
        let result = strategy(&input);
        let routes = (0..int(result[2]))
            .map(|i| Route {
                path: Rc::clone(&candidates[int(result[3 + i * 4])]),
                share: result[6 + i * 4],
            })
            .collect();
        self.strategies.set(
            key,
            Strategy {
                expected: result[0],
                wait: result[1],
                routes,
            },
            1,
        )
    }
}
#[derive(Clone)]
struct Flow {
    from: usize,
    to: usize,
    purpose: usize,
    back: bool,
    trips: f64,
    demand: f64,
    path: Rc<Path>,
    minutes: f64,
    population: f64,
    walk: f64,
    rail: f64,
    road: f64,
    hub: Option<usize>,
    kind: Option<usize>,
    options: usize,
}
fn hub_share(h: &Hub, minutes: f64, walk: f64, fare: f64, km: f64, staff: bool) -> f64 {
    let value = if staff { 40.0 } else { 60.0 };
    let rail = minutes + 1.3 * walk + fare / value;
    let reference = 12.0 + km / 30.0 * 60.0 + (180.0 + km * 12.0) / value;
    let anchor = if staff { 0.35 } else { h.reference };
    let log_odds = crate::demand::log(anchor / (1.0 - anchor)) + (reference - rail) / 12.0;
    1.0 / (1.0 + crate::demand::raw_exp(max(-60.0, min(60.0, -log_odds))))
}
fn flows(
    w: &World,
    groups: &Groups,
    alloc: &mut [HubAllocation],
    routing: &mut Routing,
) -> (Vec<Flow>, f64, [f64; 3]) {
    let mut out: Vec<Flow> = vec![];
    let mut keys = HashMap::new();
    let mut eligible = 0.0;
    let mut purpose_totals = [0.0; 3];
    for g in &groups.values {
        if g.people < 1e-8 {
            continue;
        }
        eligible += g.people;
        let staff = matches!(g.kind, Some(2) | Some(3));
        let value = if g.hub.is_some() && !staff {
            60.0
        } else {
            VOT[g.purpose]
        };
        let strat = routing.get(g.from, g.to, g.purpose, value);
        if strat.routes.is_empty() {
            continue;
        }
        let access = g.access / g.people;
        let access_cost = g.cost / g.people;
        let km = g.km / g.people;
        let fare = strat
            .routes
            .iter()
            .fold(0.0, |v, a| v + a.path.row[8] * a.share);
        let minutes = strat.expected - fare / value;
        let share = if let Some(hub) = g.hub {
            hub_share(&w.hubs[hub], minutes, access, fare, km, staff)
        } else {
            mode_value(&[
                VOT[g.purpose],
                minutes,
                access_cost,
                fare,
                km,
                if km <= 5.0 { 1.0 } else { 0.0 },
                if km <= 12.0 { 0.35 } else { 0.0 },
                0.5,
                1.0,
                1.0,
            ])
        };
        for a in &strat.routes {
            let trips = g.people * share * a.share;
            if trips < 1e-8 {
                continue;
            }
            let first = &routing.graph.edges[a.path.edges[0]];
            let adjusted = a.path.row[7] - first.headway / 2.0 + strat.wait;
            let flow = Flow {
                from: g.from,
                to: g.to,
                purpose: g.purpose,
                back: g.back,
                trips,
                demand: trips,
                path: Rc::clone(&a.path),
                minutes: adjusted,
                population: g.people * a.share,
                walk: access,
                rail: adjusted + access,
                road: 8.0 + km / 23.0 * 60.0 * 1.22,
                hub: g.hub,
                kind: g.kind,
                options: strat.routes.len(),
            };
            let key = (g.from, g.to, g.purpose, g.back, g.hub, g.kind, first.group);
            if let Some(&i) = keys.get(&key) {
                let prior: &mut Flow = &mut out[i];
                let old = prior.demand;
                prior.walk = (prior.walk * old + flow.walk * trips) / (old + trips);
                prior.rail = (prior.rail * old + flow.rail * trips) / (old + trips);
                prior.road = (prior.road * old + flow.road * trips) / (old + trips);
                prior.population += flow.population;
                prior.trips += trips;
                prior.demand += trips;
                prior.options = prior.options.max(flow.options);
            } else {
                keys.insert(key, out.len());
                out.push(flow);
            }
            purpose_totals[g.purpose] += trips;
            if let Some(hub) = g.hub {
                let st = &mut alloc[hub];
                st.riders += trips;
                if staff {
                    st.staff_riders += trips;
                } else {
                    st.passenger_riders += trips;
                }
                if matches!(g.kind, Some(0) | Some(5) | Some(3)) {
                    st.arrived += trips;
                } else {
                    st.departed += trips;
                }
            }
        }
    }
    (out, eligible, purpose_totals)
}
fn write_path(out: &mut Vec<f64>, p: &Path, minutes: f64) {
    out.extend_from_slice(&[
        p.row[1],
        p.row[2],
        p.row[3],
        p.row[5],
        p.row[4],
        p.row[6],
        minutes,
        p.row[8],
        p.row[9],
        p.row[10],
        p.edges.len() as f64,
    ]);
    for &e in &p.edges {
        out.push(e as f64);
    }
    out.push(p.fares.len() as f64);
    for &(line, value) in &p.fares {
        out.extend_from_slice(&[line as f64, value]);
    }
}
fn forecast(w: &World, p: &Prepared, graph: &Graph) -> (Vec<f64>, usize) {
    assert!(!graph.legacy);
    assert_eq!(graph.adj.len(), w.nodes.len());
    assert_eq!(graph.edges.len(), w.edge_tracks.len());
    let index = Index::new(w);
    let catchment = assign(w, &index);
    let total = if w.effective {
        activity_budgets(&w.totals)
            .iter()
            .fold(0.0, |v, b| v + b[2] * 2.0)
    } else {
        w.totals[0] * 1.6
    };
    let mut out = vec![1.0, if w.services > 0 { 1.0 } else { 0.0 }, 0.0];
    if w.services == 0 {
        out.extend_from_slice(&[
            total,
            total,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            p.zones.len() as f64,
            0.0,
            0.0,
        ]);
        for b in p.budgets {
            out.extend_from_slice(&[b[0], b[1], b[2], 0.0]);
        }
        write_catchment(&mut out, w, &catchment);
        out.push(w.hubs.len() as f64);
        for _ in &w.hubs {
            out.extend_from_slice(&[
                if w.urban { 0.0 } else { 1.0 },
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
                1.0,
                0.0,
                0.0,
                0.0,
                0.0,
                0.0,
            ]);
        }
        out.extend_from_slice(&[0.0, 0.0, 0.0, 0.0]);
        return (out, 0);
    }
    let (groups, mut hubs, visitor_budget) = hub_groups(w, p, &catchment, &index, graph);
    let mut routing = Routing::new(graph);
    let (mut flows, eligible, purposes) = flows(w, &groups, &mut hubs, &mut routing);
    let nt = w.track_count;
    let nl = graph.prices.len();
    let mut capacity_input = vec![
        nt as f64,
        flows.len() as f64,
        nl as f64,
        w.runs.len() as f64,
    ];
    for (headway, seats, tracks) in &w.runs {
        capacity_input.extend_from_slice(&[*headway, *seats, tracks.len() as f64]);
        for &id in tracks {
            capacity_input.push(id as f64);
        }
    }
    let mut track_order = vec![];
    let mut line_order = vec![];
    let mut seen_track = vec![false; nt];
    let mut seen_line = vec![false; nl];
    for f in &flows {
        let mut tracks = vec![];
        let mut lines = vec![];
        for &edge in &f.path.edges {
            for &id in &w.edge_tracks[edge] {
                tracks.push(id);
                if !seen_track[id] {
                    seen_track[id] = true;
                    track_order.push(id);
                }
            }
            for &(id, _) in &graph.edges[edge].parts {
                if !lines.contains(&id) {
                    lines.push(id);
                }
                if !seen_line[id] {
                    seen_line[id] = true;
                    line_order.push(id);
                }
            }
        }
        capacity_input.extend_from_slice(&[f.trips, tracks.len() as f64]);
        for id in tracks {
            capacity_input.push(id as f64);
        }
        capacity_input.push(lines.len() as f64);
        for id in lines {
            capacity_input.push(id as f64);
        }
    }
    let capacity = crate::demand::capacity(&capacity_input);
    for (i, f) in flows.iter_mut().enumerate() {
        f.trips = capacity[2 + nt * 3 + i];
    }
    out[2] = routing.searches as f64;
    out.extend_from_slice(&[
        total,
        max(0.0, total - eligible),
        capacity[0],
        capacity[1],
        purposes[0],
        purposes[1],
        purposes[2],
        eligible,
        groups.values.len() as f64,
        p.zones.len() as f64,
        p.matrices[0],
        p.matrices[1],
    ]);
    for purpose in 0..3 {
        let b = &p.budgets[purpose];
        out.extend_from_slice(&[b[0], b[1], b[2], p.matrices[2 + purpose]]);
    }
    write_catchment(&mut out, w, &catchment);
    out.push(hubs.len() as f64);
    for h in &hubs {
        out.extend_from_slice(&[
            h.activation,
            h.riders,
            h.arrived,
            h.departed,
            h.staff_riders,
            h.passenger_riders,
            visitor_budget[0],
            visitor_budget[1],
            h.capture,
            h.mass,
            h.development,
            h.connections.len() as f64,
        ]);
        for a in &h.connections {
            out.extend_from_slice(&[a.id as f64, a.km, a.share]);
        }
    }
    out.push(track_order.len() as f64);
    for id in track_order {
        out.extend_from_slice(&[id as f64, capacity[3 + id * 3]]);
    }
    out.push(nt as f64);
    for id in 0..nt {
        out.extend_from_slice(&[id as f64, capacity[4 + id * 3]]);
    }
    out.push(line_order.len() as f64);
    for id in line_order {
        out.extend_from_slice(&[id as f64, capacity[2 + nt * 3 + flows.len() + id * 2 + 1]]);
    }
    out.push(flows.len() as f64);
    for f in &flows {
        out.extend_from_slice(&[
            f.from as f64,
            f.to as f64,
            f.purpose as f64,
            if f.back { 1.0 } else { 0.0 },
            f.trips,
            f.demand,
            f.population,
            f.walk,
            f.rail,
            f.road,
            f.hub.map_or(-1.0, |h| h as f64),
            f.kind.map_or(-1.0, |k| k as f64),
            f.options as f64,
        ]);
        write_path(&mut out, &f.path, f.minutes);
    }
    routing.trees.write(&mut out);
    routing.strategies.write(&mut out);
    (out, routing.searches)
}
#[no_mangle]
pub extern "C" fn world_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn forecast_run() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core {
            input,
            output,
            graph,
            searches,
            world_cache,
            ..
        } = &mut *c;
        let fees = int(input[0]);
        let graph = graph.as_mut().expect("forecast graph missing");
        assert_eq!(fees, graph.prices.len() * 6 + graph.companies.len());
        for (ix, price) in graph.prices.iter_mut().enumerate() {
            price.copy_from_slice(&input[1 + ix * 6..1 + ix * 6 + 6]);
        }
        for (ix, price) in graph.companies.iter_mut().enumerate() {
            *price = input[1 + graph.prices.len() * 6 + ix];
        }
        let world = World::parse(&input[1 + fees..]);
        // A blank network has no OD allocation. Keep the existing prepared city untouched.
        let prepared = if world.services == 0 {
            Rc::new(Prepared {
                token: world.token,
                zones: vec![],
                matrices: vec![],
                budgets: activity_budgets(&world.totals),
            })
        } else {
            world.prepared(world_cache)
        };
        *output = vec![];
        let (result, count) = forecast(&world, &prepared, graph);
        *output = result;
        *searches = searches.saturating_add(count as u32);
        output.as_ptr()
    })
}
#[no_mangle]
pub extern "C" fn world_run() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core {
            input,
            output,
            world_cache,
            ..
        } = &mut *c;
        *output = vec![];
        let op = int(input[0]);
        if op == 3 {
            let p = Point {
                x: input[1],
                y: input[2],
            };
            let feeders = input[3] != 0.0;
            let count = int(input[4]);
            assert_eq!(input.len(), 5 + count * 3);
            let stations = (0..count)
                .map(|i| {
                    (
                        int(input[5 + i * 3]),
                        Point {
                            x: input[6 + i * 3],
                            y: input[7 + i * 3],
                        },
                    )
                })
                .collect::<Vec<_>>();
            let list = choices(&p, &stations, feeders);
            output.push(list.len() as f64);
            for a in list {
                output.extend_from_slice(&[
                    a.id as f64,
                    a.km,
                    a.time,
                    a.mode as f64,
                    a.cost,
                    a.weight,
                    a.share,
                ]);
            }
        } else if op == 2 {
            let p = Point {
                x: input[1],
                y: input[2],
            };
            let radius = input[3];
            let count = int(input[4]);
            assert_eq!(input.len(), 5 + count * 13);
            let mut r = Read { v: input, at: 5 };
            let mut values = [0.0; 5];
            let (mut cells, mut factory, mut survey, mut population) = (0.0, 0.0, 0.0, 0.0);
            for _ in 0..count {
                let c = cell(&mut r);
                if distance(&p, &c.p) * 1.25 > radius + 1.5 {
                    continue;
                }
                let mut share = 0.0;
                for y in 0..4 {
                    for x in 0..4 {
                        let q = Point {
                            x: c.p.x + ((x as f64 + 0.5) / 4.0 - 0.5) * c.w,
                            y: c.p.y + ((y as f64 + 0.5) / 4.0 - 0.5) * c.h,
                        };
                        if distance(&p, &q) * 1.25 <= radius {
                            share += W;
                        }
                    }
                }
                if share == 0.0 {
                    continue;
                }
                for k in 0..5 {
                    values[k] += c.values[k] * share;
                }
                factory += c.factory * share;
                cells += share;
                survey += c.survey * c.area * share;
                if c.pop_valid {
                    population += c.area * share;
                }
            }
            output.extend(values);
            output.extend_from_slice(&[
                cells,
                std::f64::consts::PI * radius * radius,
                factory,
                survey,
                population,
            ]);
        } else {
            let w = World::parse(&input[1..]);
            if op == 0 {
                let index = Index::new(&w);
                let c = assign(&w, &index);
                write_catchment(output, &w, &c);
            } else if op == 1 {
                let p = w.prepared(world_cache);
                output.push(p.zones.len() as f64);
                for z in &p.zones {
                    output.extend_from_slice(&[
                        z.bin.0 as f64,
                        z.bin.1 as f64,
                        z.p.x,
                        z.p.y,
                        z.count as f64,
                        z.area,
                    ]);
                    output.extend(z.values);
                    output.push(z.cells.len() as f64);
                    for &ci in &z.cells {
                        output.push(ci as f64);
                    }
                }
                for purpose in 0..3 {
                    let b = &p.budgets[purpose];
                    output.extend_from_slice(&[b[0], b[1], b[2], p.matrices[2 + purpose]]);
                }
                output.extend_from_slice(&p.matrices);
            } else {
                panic!("unknown world operation");
            }
        }
        output.as_ptr()
    })
}

/// Compatibility calls for low-frequency public APIs; forecasts call these rules internally.
#[no_mangle]
pub extern "C" fn world_policy() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core { input, output, .. } = &mut *c;
        *output = vec![];
        match int(input[0]) {
            0 => {
                assert_eq!(input.len(), 6);
                let totals = [input[1], input[2], input[3], input[4], input[5]];
                for budget in activity_budgets(&totals) {
                    output.extend(budget);
                }
            }
            1 => {
                assert_eq!(input.len(), 5);
                let cap = max(0.0, input[1] * 0.8 + input[2] * 0.65 + input[3] * 0.12);
                output.extend_from_slice(&[
                    cap,
                    if input[4] > 0.0 {
                        min(1.0, cap / input[4])
                    } else {
                        1.0
                    },
                ]);
            }
            2 => {
                let n = int(input[1]);
                assert_eq!(input.len(), 2 + n + n * n);
                output.extend_from_slice(&input[2 + n..]);
                for i in 0..n {
                    let mut sum = 0.0;
                    for j in 0..n {
                        sum += output[i * n + j];
                    }
                    if sum > input[2 + i] && sum > 0.0 {
                        let ratio = input[2 + i] / sum;
                        for j in 0..n {
                            output[i * n + j] *= ratio;
                        }
                    }
                }
            }
            3 => {
                let nh = int(input[1]);
                let nz = int(input[2]);
                assert_eq!(input.len(), 3 + nz + nh * nz * 3);
                let mut staff = vec![0.0; nz];
                let mut local = vec![0.0; nz];
                for h in 0..nh {
                    for z in 0..nz {
                        let at = 3 + nz + (h * nz + z) * 3;
                        let ok = input[at + 2] != 0.0;
                        let s = if ok { input[at] } else { 0.0 };
                        let l = if ok { input[at + 1] } else { 0.0 };
                        output.extend_from_slice(&[s, l]);
                        staff[z] += s;
                        local[z] += l;
                    }
                }
                for h in 0..nh {
                    for z in 0..nz {
                        let at = (h * nz + z) * 2;
                        output[at] *= if staff[z] != 0.0 {
                            min(1.0, input[3 + z] * 0.52 * 0.25 / staff[z])
                        } else {
                            0.0
                        };
                        output[at + 1] *= if local[z] != 0.0 {
                            min(1.0, input[3 + z] * 0.12 * 0.25 / local[z])
                        } else {
                            0.0
                        };
                    }
                }
            }
            4 => {
                assert_eq!(input.len(), 7);
                let staff = input[6] != 0.0;
                let value = if staff { 40.0 } else { 60.0 };
                let rail = input[2] + 1.3 * input[3] + input[4] / value;
                let reference = 12.0 + input[5] / 30.0 * 60.0 + (180.0 + input[5] * 12.0) / value;
                let anchor = if staff { 0.35 } else { input[1] };
                let log_odds =
                    crate::demand::log(anchor / (1.0 - anchor)) + (reference - rail) / 12.0;
                output.push(1.0 / (1.0 + crate::demand::raw_exp(max(-60.0, min(60.0, -log_odds)))));
            }
            _ => panic!("unknown world policy"),
        }
        output.as_ptr()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn access_keeps_stable_ties_and_bounded_choices() {
        let point = Point { x: 0.0, y: 0.0 };
        let stops = vec![
            (3, point.clone()),
            (2, point.clone()),
            (1, point.clone()),
            (0, point.clone()),
        ];
        let result = choices(&point, &stops, true);
        assert_eq!(
            result.iter().map(|a| a.id).collect::<Vec<_>>(),
            vec![3, 2, 1]
        );
        assert_eq!(result.iter().map(|a| a.share).sum::<f64>(), 1.0);
        let far = vec![(0, Point { x: 100.0, y: 0.0 })];
        assert!(choices(&point, &far, true).is_empty());
    }
    #[test]
    fn cache_touch_replacement_and_weight_eviction_are_bounded() {
        let mut cache = Lru::new(2, 6);
        cache.set(1, 10, 3);
        cache.set(2, 20, 3);
        assert_eq!(*cache.get(&1).unwrap(), 10);
        cache.set(3, 30, 3);
        assert!(cache.get(&2).is_none());
        assert_eq!(cache.stats.evictions, 1);
        cache.set(1, 11, 2);
        assert_eq!(*cache.get(&1).unwrap(), 11);
        assert_eq!(cache.stats.weight, 5);
        assert_eq!(*cache.set(4, 40, 7), 40);
        assert!(cache.get(&4).is_none());
        assert_eq!(cache.stats.oversized, 1);
        assert!(cache.stats.weight <= 6);
        assert_eq!(cache.map.len(), cache.order.len());
    }
    #[test]
    fn activity_capacity_caps_each_purpose() {
        let budgets = activity_budgets(&[1000.0, 10.0, 20.0, 50.0, 30.0]);
        assert_eq!(
            budgets,
            [[520.0, 9.5, 9.5], [160.0, 36.0, 36.0], [120.0, 45.0, 45.0]]
        );
        assert_eq!(activity_budgets(&[0.0; 5]), [[0.0; 3]; 3]);
    }
}
