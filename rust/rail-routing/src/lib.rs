//! Deterministic metro routing and demand kernels with versioned f64-array ABIs.
//! Heap tie order, tolerances and arithmetic order intentionally match the frozen JS oracle.
mod demand;
mod numbers;
mod queues;
mod simulation;
mod world;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

const ABI: f64 = 1.0;
const NONE: usize = usize::MAX;
const STRIDE: usize = 14;
const LIMITS: [f64; 6] = [6.0, 11.0, 19.0, 27.0, 40.0, 999.0];

#[derive(Clone)]
struct Edge {
    to: usize,
    service: usize,
    dir: i32,
    km: f64,
    minutes: f64,
    headway: f64,
    group: u32,
    parts: Vec<(usize, f64)>,
    owner: u32,
    fare: f64,
    penalty: f64,
    through: bool,
}
struct Graph {
    legacy: bool,
    adj: Vec<Vec<usize>>,
    edges: Vec<Edge>,
    prices: Vec<[f64; 6]>,
    companies: Vec<f64>,
}
#[derive(Clone)]
struct State {
    node: usize,
    service: usize,
    dir: i32,
    last_line: usize,
    board: usize,
    fare_km: f64,
    cost: f64,
    minutes: f64,
    fare: f64,
    km: f64,
    previous: usize,
    edge: usize,
    depth: usize,
    transfers: u32,
    paid: u32,
    discounted: u32,
}
type Key = [usize; 5];
impl State {
    fn key(&self, legacy: bool) -> Key {
        if legacy {
            [
                self.node,
                self.service,
                self.paid as usize,
                self.discounted as usize,
                0,
            ]
        } else {
            [
                self.node,
                self.service,
                self.dir as usize,
                self.last_line,
                self.board,
            ]
        }
    }
}
#[derive(Default)]
struct Core {
    input: Vec<f64>,
    output: Vec<f64>,
    graph: Option<Graph>,
    searches: u32,
    world_cache: Option<Rc<world::Prepared>>,
    simulation_state: Option<simulation::MotionState>,
    queue_state: Option<queues::Queues>,
    sampling_state: Option<simulation::Sampling>,
}
thread_local! { static CORE: RefCell<Core> = RefCell::new(Core::default()); }

fn int(value: f64) -> usize {
    assert!(value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= u32::MAX as f64);
    value as usize
}
fn finite(value: f64) -> f64 {
    assert!(value.is_finite());
    value
}
fn fare(prices: &[f64; 6], km: f64) -> f64 {
    if km <= 1e-9 {
        return 0.0;
    }
    let rounded = (km - 1e-8).ceil();
    prices[LIMITS.iter().position(|v| rounded <= *v).unwrap_or(5)]
}
fn parse_graph(v: &[f64]) -> Graph {
    assert!(v.len() >= 7 && v[0] == ABI);
    let legacy = v[1] == 1.0;
    let (nodes, lines, count, parts, companies) =
        (int(v[2]), int(v[3]), int(v[4]), int(v[5]), int(v[6]));
    assert_eq!(v.len(), 7 + count * 15 + parts * 2);
    let mut graph = Graph {
        legacy,
        adj: vec![vec![]; nodes],
        edges: Vec::with_capacity(count),
        prices: vec![[0.0; 6]; lines],
        companies: vec![0.0; companies],
    };
    let part_offset = 7 + count * 15;
    for ix in 0..count {
        let r = &v[7 + ix * 15..7 + (ix + 1) * 15];
        let (from, to, start, len) = (int(r[0]), int(r[1]), int(r[9]), int(r[10]));
        assert!(from < nodes && to < nodes && start + len <= parts);
        assert!(r[3] == -1.0 || r[3] == 0.0 || r[3] == 1.0);
        let mut edge_parts = Vec::with_capacity(len);
        for p in start..start + len {
            let at = part_offset + p * 2;
            let line = int(v[at]);
            assert!(line < lines);
            edge_parts.push((line, finite(v[at + 1])));
        }
        graph.adj[from].push(ix);
        graph.edges.push(Edge {
            to,
            service: int(r[2]),
            dir: r[3] as i32,
            km: finite(r[5]),
            minutes: finite(r[6]),
            headway: finite(r[7]),
            group: int(r[8]) as u32,
            parts: edge_parts,
            owner: int(r[11]) as u32,
            fare: finite(r[12]),
            penalty: finite(r[13]),
            through: r[14] == 1.0,
        });
    }
    graph
}
fn push(heap: &mut Vec<usize>, states: &[State], ix: usize) {
    let mut i = heap.len();
    heap.push(ix);
    while i > 0 {
        let j = (i - 1) >> 1;
        if states[heap[j]].cost <= states[ix].cost {
            break;
        }
        heap[i] = heap[j];
        i = j;
    }
    heap[i] = ix;
}
fn pop(heap: &mut Vec<usize>, states: &[State]) -> usize {
    let first = heap[0];
    let last = heap.pop().unwrap();
    if !heap.is_empty() {
        let mut i = 0;
        while i * 2 + 1 < heap.len() {
            let mut j = i * 2 + 1;
            if j + 1 < heap.len() && states[heap[j + 1]].cost < states[heap[j]].cost {
                j += 1;
            }
            if states[last].cost <= states[heap[j]].cost {
                break;
            }
            heap[i] = heap[j];
            i = j;
        }
        heap[i] = last;
    }
    first
}
fn route_edges(states: &[State], mut ix: usize) -> Vec<usize> {
    let mut edges = Vec::with_capacity(states[ix].depth);
    while states[ix].previous != NONE {
        edges.push(states[ix].edge);
        ix = states[ix].previous;
    }
    edges.reverse();
    edges
}
fn search(graph: &Graph, origin: usize, value: f64, first_group: u32) -> Vec<f64> {
    assert!(origin < graph.adj.len() && value.is_finite() && value >= 0.0);
    let first = State {
        node: origin,
        service: 0,
        dir: 0,
        last_line: 0,
        board: origin,
        fare_km: 0.0,
        cost: 0.0,
        minutes: 0.0,
        fare: 0.0,
        km: 0.0,
        previous: NONE,
        edge: NONE,
        depth: 0,
        transfers: 0,
        paid: 0,
        discounted: 0,
    };
    let mut best = HashMap::from([(first.key(graph.legacy), (0.0, 0))]);
    let mut done = HashSet::new();
    let mut states = vec![first];
    let mut heap = vec![0];
    let mut result = vec![NONE; graph.adj.len()];
    let mut result_len = origin + 1;
    while !heap.is_empty() {
        let ix = pop(&mut heap, &states);
        let cur = states[ix].clone();
        let key = cur.key(graph.legacy);
        if graph.legacy {
            if done.contains(&key) || best[&key].1 != ix {
                continue;
            }
            done.insert(key);
        } else if cur.cost > best[&key].0 + 1e-8 {
            continue;
        }
        if result[cur.node] == NONE || cur.cost < states[result[cur.node]].cost {
            result[cur.node] = ix;
            result_len = result_len.max(cur.node + 1);
        }
        for &edge_ix in &graph.adj[cur.node] {
            let e = &graph.edges[edge_ix];
            if !graph.legacy
                && (cur.depth > 120
                    || (cur.depth == 0 && first_group != u32::MAX && e.group != first_group))
            {
                continue;
            }
            let change = e.service != cur.service || (!graph.legacy && e.dir != cur.dir);
            let transfer = change && cur.service != 0;
            let extra = if change {
                e.headway / 2.0 + if transfer { 4.0 } else { 0.0 }
            } else {
                0.0
            };
            let extra = if graph.legacy {
                extra + e.penalty
            } else {
                extra
            };
            let mut fee = 0.0;
            let (mut last_line, mut fare_km, mut board) = (cur.last_line, cur.fare_km, cur.board);
            let (mut paid, mut discounted) = (cur.paid, cur.discounted);
            if graph.legacy {
                let bit = 1u32.wrapping_shl(e.owner);
                paid |= bit;
                fee = if cur.paid & bit != 0 { 0.0 } else { e.fare };
                if e.through {
                    let mut prior = 0;
                    let mut ancestor = ix;
                    while states[ancestor].previous != NONE {
                        let prev = &graph.edges[states[ancestor].edge];
                        if prev.service == e.service {
                            prior |= 1u32.wrapping_shl(prev.owner);
                        }
                        ancestor = states[ancestor].previous;
                    }
                    if prior != 0 && prior & bit == 0 {
                        let eligible = (prior | bit) & !discounted;
                        for (ci, price) in graph.companies.iter().enumerate() {
                            if eligible & 1u32.wrapping_shl(ci as u32) != 0 {
                                fee -= price * 0.15;
                            }
                        }
                        discounted |= prior | bit;
                    }
                }
            } else {
                for &(line, km) in &e.parts {
                    if line != last_line {
                        last_line = line;
                        fare_km = 0.0;
                        board = cur.node;
                    }
                    let amount = fare(&graph.prices[line], fare_km + km)
                        - fare(&graph.prices[line], fare_km);
                    fare_km += km;
                    fee += amount;
                }
            }
            let candidate = State {
                node: e.to,
                service: e.service,
                dir: e.dir,
                last_line,
                board,
                fare_km,
                cost: cur.cost + e.minutes + extra + fee * value,
                minutes: cur.minutes + e.minutes + extra,
                fare: cur.fare + fee,
                km: cur.km + e.km,
                previous: ix,
                edge: edge_ix,
                depth: cur.depth + 1,
                transfers: cur.transfers + if transfer { 1 } else { 0 },
                paid,
                discounted,
            };
            let key = candidate.key(graph.legacy);
            let tolerance = if graph.legacy { 0.000001 } else { 1e-8 };
            if best
                .get(&key)
                .map_or(true, |v| candidate.cost < v.0 - tolerance)
            {
                best.insert(key, (candidate.cost, states.len()));
                if graph.legacy {
                    done.remove(&key);
                }
                let index = states.len();
                states.push(candidate);
                push(&mut heap, &states, index);
            }
        }
    }
    // Each returned buffer owns its data. No caller-held native search handles or finalizers.
    let trail_offset = 8 + result_len * STRIDE;
    let fares_offset = trail_offset + states.len() * 2;
    let mut out = vec![0.0; fares_offset];
    out[..8].copy_from_slice(&[
        ABI,
        result_len as f64,
        states.len() as f64,
        states.len() as f64,
        8.0,
        trail_offset as f64,
        fares_offset as f64,
        if graph.legacy { 1.0 } else { 0.0 },
    ]);
    for node in 0..result_len {
        let at = 8 + node * STRIDE;
        if result[node] == NONE {
            out[at] = -1.0;
            continue;
        }
        let p = &states[result[node]];
        let mut fares: Vec<(usize, f64)> = vec![];
        if !graph.legacy {
            let (mut line, mut km) = (0, 0.0);
            for edge in route_edges(&states, result[node]) {
                for &(id, distance) in &graph.edges[edge].parts {
                    if id != line {
                        line = id;
                        km = 0.0;
                    }
                    let amount =
                        fare(&graph.prices[id], km + distance) - fare(&graph.prices[id], km);
                    km += distance;
                    if let Some(row) = fares.iter_mut().find(|r| r.0 == id) {
                        row.1 += amount;
                    } else {
                        fares.push((id, amount));
                    }
                }
            }
        }
        let offset = out.len();
        out[at..at + STRIDE].copy_from_slice(&[
            p.node as f64,
            p.service as f64,
            p.dir as f64,
            if graph.legacy {
                p.paid as i32 as f64
            } else {
                p.last_line as f64
            },
            if graph.legacy {
                p.discounted as i32 as f64
            } else {
                p.board as f64
            },
            p.fare_km,
            p.cost,
            p.minutes,
            p.fare,
            p.km,
            p.transfers as f64,
            result[node] as f64,
            offset as f64,
            fares.len() as f64,
        ]);
        for (id, amount) in fares {
            out.extend_from_slice(&[id as f64, amount]);
        }
    }
    for (ix, p) in states.iter().enumerate() {
        let at = trail_offset + ix * 2;
        out[at] = if p.previous == NONE {
            -1.0
        } else {
            p.previous as f64
        };
        out[at + 1] = if p.edge == NONE { -1.0 } else { p.edge as f64 };
    }
    out
}

#[no_mangle]
pub extern "C" fn routing_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn input_resize(length: usize) -> *mut f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        c.input.resize(length, 0.0);
        c.input.as_mut_ptr()
    })
}
#[no_mangle]
pub extern "C" fn graph_load() {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let graph = parse_graph(&c.input);
        c.graph = Some(graph);
    })
}
#[no_mangle]
pub extern "C" fn route_search(origin: usize, value: f64, first_group: u32) -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let Core {
            input,
            output,
            graph,
            searches,
            ..
        } = &mut *c;
        let graph = graph.as_mut().expect("routing graph not loaded");
        assert_eq!(input.len(), graph.prices.len() * 6 + graph.companies.len());
        for (ix, price) in graph.prices.iter_mut().enumerate() {
            price.copy_from_slice(&input[ix * 6..ix * 6 + 6]);
        }
        for (ix, price) in graph.companies.iter_mut().enumerate() {
            *price = input[graph.prices.len() * 6 + ix];
        }
        // Drop the previous output before allocating a new search result.
        *output = Vec::new();
        *output = search(graph, origin, value, first_group);
        *searches = searches.saturating_add(1);
        output.as_ptr()
    })
}
#[no_mangle]
pub extern "C" fn output_len() -> usize {
    CORE.with(|c| c.borrow().output.len())
}
#[no_mangle]
pub extern "C" fn output_clear() {
    CORE.with(|c| c.borrow_mut().output = Vec::new());
}
#[no_mangle]
pub extern "C" fn search_count() -> u32 {
    CORE.with(|c| c.borrow().searches)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tariff_boundaries() {
        let price = [180.0, 210.0, 260.0, 300.0, 330.0, 400.0];
        assert_eq!(fare(&price, 0.0), 0.0);
        assert_eq!(fare(&price, 6.0), 180.0);
        assert_eq!(fare(&price, 6.000000001), 180.0);
        assert_eq!(fare(&price, 6.0001), 210.0);
        assert_eq!(fare(&price, 1001.0), 400.0);
    }
    #[test]
    fn heap_ties_keep_insertion_rules() {
        let mut states = vec![];
        for cost in [2.0, 1.0, 1.0, 3.0] {
            states.push(State {
                node: 0,
                service: 0,
                dir: 0,
                last_line: 0,
                board: 0,
                fare_km: 0.0,
                cost,
                minutes: 0.0,
                fare: 0.0,
                km: 0.0,
                previous: NONE,
                edge: NONE,
                depth: 0,
                transfers: 0,
                paid: 0,
                discounted: 0,
            });
        }
        let mut heap = vec![];
        for ix in 0..states.len() {
            push(&mut heap, &states, ix);
        }
        assert_eq!(
            (0..4).map(|_| pop(&mut heap, &states)).collect::<Vec<_>>(),
            vec![1, 2, 0, 3]
        );
    }
}
