//! Cold itinerary/geometry transactions, with routing and identity decisions inside Rust.
use crate::{
    parse_graph, search,
    value::{object, Value as V},
    Graph,
};
use std::collections::{HashMap, HashSet};
fn n(v: f64) -> V {
    V::Number(v)
}
fn text(v: impl Into<String>) -> V {
    V::String(v.into())
}
fn obj() -> V {
    V::Object(vec![])
}
fn json_clone(v: &V) -> V {
    match v {
        V::Missing => V::Null,
        V::Number(x) if !x.is_finite() => V::Null,
        V::Array(a) => V::Array(a.iter().map(json_clone).collect()),
        V::Object(a) => V::Object(
            a.iter()
                .filter(|(_, v)| !matches!(v, V::Missing))
                .map(|(k, v)| (k.clone(), json_clone(v)))
                .collect(),
        ),
        _ => v.clone(),
    }
}
fn add(v: &mut V, k: &str, x: f64) {
    let a = v.zero(k);
    v.set(k, n(a + x));
}
pub(super) struct Routing {
    graph: Graph,
    meta: V,
    trees: HashMap<(usize, String), Vec<f64>>,
    routes: HashMap<(usize, usize, String, u64), Option<V>>,
}
impl Routing {
    pub(super) fn weights(&self) -> Vec<f64> {
        self.graph
            .edges
            .iter()
            .flat_map(|e| [e.headway, e.minutes])
            .collect()
    }
    pub(super) fn update_weights(&mut self, rows: &V) {
        let map = rows
            .array()
            .iter()
            .map(|r| {
                let a = r.array();
                (a[0].text(), (a[1].n(), a[2].n()))
            })
            .collect::<HashMap<_, _>>();
        for e in &mut self.graph.edges {
            let name = self.meta.get("services").array()[e.service].text();
            if let Some(&(h, dwell)) = map.get(name) {
                e.headway = h;
                e.minutes = e.km / 48.0 * 60.0 + dwell;
            }
        }
    }
    pub(super) fn seed_trees(&mut self, rows: &V) {
        for row in rows.array() {
            let a = row.array();
            self.trees.insert(
                (a[0].n() as usize, a[1].text().into()),
                a[2].array().iter().map(V::n).collect(),
            );
        }
    }
    pub(super) fn seed(&mut self, rows: &V) {
        for row in rows.array() {
            let a = row.array();
            let fare = a[3].n();
            self.routes.insert(
                (
                    a[0].n() as usize,
                    a[1].n() as usize,
                    a[2].text().into(),
                    if fare == 0.0 { 0 } else { fare.to_bits() },
                ),
                if a[4].truth() {
                    Some(a[4].clone())
                } else {
                    None
                },
            );
        }
    }
    pub(super) fn tree(&self, from: usize, purpose: &str) -> Option<&Vec<f64>> {
        self.trees.get(&(from, purpose.to_string()))
    }
    pub(super) fn new(v: V) -> Self {
        let data = v.get("data").array().iter().map(V::n).collect::<Vec<_>>();
        let mut graph = parse_graph(&data);
        let prices = v.get("prices").array();
        for (i, p) in graph.prices.iter_mut().enumerate() {
            for k in 0..6 {
                p[k] = prices[i * 6 + k].n();
            }
        }
        let at = graph.prices.len() * 6;
        for (i, p) in graph.companies.iter_mut().enumerate() {
            *p = prices[at + i].n();
        }
        let weights = v.get("weights").clone();
        let mut out = Self {
            graph,
            meta: v,
            trees: HashMap::new(),
            routes: HashMap::new(),
        };
        out.update_weights(&weights);
        out
    }
    pub(super) fn route(&mut self, j: &V, from: usize, id: usize) -> Option<V> {
        let to = j.num("to") as usize;
        if from == to {
            return None;
        }
        let purpose = j.get("purpose").text().to_string();
        let fare = j.num("fare");
        let cache = (
            from,
            to,
            purpose.clone(),
            if fare == 0.0 { 0 } else { fare.to_bits() },
        );
        if let Some(v) = self.routes.get(&cache) {
            return v.clone();
        }
        let tree = self
            .trees
            .entry((from, purpose.clone()))
            .or_insert_with(|| {
                search(
                    &self.graph,
                    from,
                    1.0 / match purpose.as_str() {
                        "shopping" => 25.0,
                        "leisure" => 20.0,
                        _ => 40.0,
                    },
                    u32::MAX,
                )
            });
        let at = 8 + to * 14;
        if at >= tree.len() || tree[at] < 0.0 {
            self.routes.insert(cache, None);
            return None;
        }
        let mut trail = tree[at + 11] as usize;
        let offset = tree[5] as usize;
        let mut indices = vec![];
        while tree[offset + trail * 2] >= 0.0 {
            indices.push(tree[offset + trail * 2 + 1] as usize);
            trail = tree[offset + trail * 2] as usize;
        }
        indices.reverse();
        if indices.is_empty() {
            self.routes.insert(cache, None);
            return None;
        }
        let mut legs: Vec<V> = vec![];
        let mut origin = from;
        for ix in &indices {
            let e = &self.graph.edges[*ix];
            let service = self.meta.get("services").array()[e.service].clone();
            let dir = e.dir as f64;
            if let Some(last) = legs.last_mut() {
                if last.get("service").text() == service.text() && last.num("dir") == dir {
                    last.set("to", n(e.to as f64));
                    origin = e.to;
                    continue;
                }
            }
            legs.push(object([
                ("service", service),
                ("dir", n(dir)),
                ("from", n(origin as f64)),
                ("to", n(e.to as f64)),
            ]));
            origin = e.to;
        }
        let mut fares = obj();
        for k in 0..tree[at + 13] as usize {
            let p = tree[at + 12] as usize + k * 2;
            let line = self.meta.get("lines").array()[tree[p] as usize].text();
            fares.set(line, n(tree[p + 1]));
        }
        let mut shares = obj();
        if tree[at + 8] > 0.0 {
            for (k, v) in fares.entries() {
                shares.set(k, n(v.n() / tree[at + 8]));
            }
        } else {
            for ix in indices {
                let e = &self.graph.edges[ix];
                let service = self.meta.get("services").array()[e.service].text();
                add(&mut shares, service, e.km / tree[at + 9]);
            }
        }
        let out = object([
            ("id", n(id as f64)),
            ("legs", V::Array(legs)),
            ("daily", n(0.0)),
            ("fare", j.get("fare").clone()),
            (
                "purpose",
                if purpose.is_empty() {
                    text("work")
                } else {
                    text(purpose)
                },
            ),
            ("back", V::Bool(j.get("back").truth())),
            (
                "hub",
                if j.get("hub").truth() {
                    j.get("hub").clone()
                } else {
                    V::Null
                },
            ),
            (
                "externalKind",
                if j.get("externalKind").truth() {
                    j.get("externalKind").clone()
                } else {
                    V::Null
                },
            ),
            ("from", n(from as f64)),
            ("to", j.get("to").clone()),
            (
                "lineIds",
                V::Array(fares.entries().iter().map(|(k, _)| text(k)).collect()),
            ),
            ("byLine", shares),
        ]);
        self.routes.insert(cache, Some(out.clone()));
        Some(out)
    }
}
fn token_id(t: &str) -> usize {
    t.split(':')
        .next()
        .unwrap_or("")
        .parse()
        .unwrap_or(usize::MAX)
}
fn remap_token(t: &str, map: &HashMap<usize, usize>) -> String {
    let (_, tail) = t.split_once(':').unwrap_or((t, ""));
    format!("{}:{}", map[&token_id(t)], tail)
}
pub(super) fn compact(rt: &mut V) {
    let mut active = HashSet::new();
    for field in ["queues", "outside"] {
        for (_, q) in rt.get(field).entries() {
            for (tok, _) in q.entries() {
                active.insert(token_id(tok));
            }
        }
    }
    for t in rt.get("trains").array() {
        for (tok, _) in t.get("passengers").entries() {
            active.insert(token_id(tok));
        }
    }
    for x in rt.get("transfers").array() {
        active.insert(x.num("journey") as usize);
    }
    let mut mapping = HashMap::new();
    let mut defs = vec![];
    let mut definition_order = vec![];
    if rt.get("definitionCount").truth() {
        let mut ids = active
            .iter()
            .copied()
            .filter(|id| *id < rt.num("definitionCount") as usize)
            .collect::<Vec<_>>();
        ids.sort_unstable();
        for id in ids {
            mapping.insert(id, definition_order.len());
            definition_order.push(n(id as f64));
        }
    }
    for j in rt.get("defs").array() {
        let id = j.num("id") as usize;
        if active.contains(&id) {
            let mut j = j.clone();
            mapping.insert(id, defs.len());
            j.set("id", n(defs.len() as f64));
            j.set("daily", n(0.0));
            defs.push(j);
        }
    }
    let remap = |q: &V| {
        V::Object(
            q.entries()
                .iter()
                .map(|(t, v)| (remap_token(t, &mapping), v.clone()))
                .collect(),
        )
    };
    for field in ["queues", "outside"] {
        let value = V::Object(
            rt.get(field)
                .entries()
                .iter()
                .map(|(k, q)| (k.clone(), remap(q)))
                .collect(),
        );
        rt.set(field, value);
    }
    for t in rt.get_mut("trains").array_mut() {
        let q = remap(t.get("passengers"));
        t.set("passengers", q);
    }
    for x in rt.get_mut("transfers").array_mut() {
        x.set("journey", n(mapping[&(x.num("journey") as usize)] as f64));
    }
    for field in ["waitSince", "outsideSince"] {
        let out = V::Object(
            rt.get(field)
                .entries()
                .iter()
                .filter_map(|(key, v)| {
                    let (prefix, t) = key.split_once('#')?;
                    mapping.get(&token_id(t))?;
                    Some((
                        format!("{}#{}", prefix, remap_token(t, &mapping)),
                        v.clone(),
                    ))
                })
                .collect(),
        );
        rt.set(field, out);
    }
    if !matches!(rt.get("defs"), V::Missing) {
        rt.set("defs", V::Array(defs));
    } else {
        rt.set("definitionOrder", V::Array(definition_order));
    }
}
fn leg_valid(plan: &V, dirs: &V, e: &V) -> bool {
    let Some(l) = plan
        .get("services")
        .array()
        .iter()
        .find(|l| l.get("id").text() == e.get("service").text())
    else {
        return false;
    };
    if !dirs
        .get(l.get("id").text())
        .array()
        .iter()
        .any(|x| x.n() == e.num("dir"))
    {
        return false;
    }
    let stops = l.get("stops").array();
    let calls = if l.get("callStops").truth() {
        l.get("callStops").array()
    } else {
        stops
    };
    let contains = |v: f64| calls.iter().any(|x| x.n() == v);
    if !contains(e.num("from")) || !contains(e.num("to")) {
        return false;
    }
    stops.first().map(V::n) == stops.last().map(V::n)
        || (stops.iter().position(|x| x.n() == e.num("to")).unwrap() as f64
            - stops.iter().position(|x| x.n() == e.num("from")).unwrap() as f64)
            * e.num("dir")
            > 0.0
}
fn migrate(
    rt: &mut V,
    routing: &mut Routing,
    plan: &V,
    dirs: &V,
    tok: &str,
    count: f64,
    station: usize,
    since: f64,
    rejected: &mut Vec<V>,
) -> Option<(V, usize, String)> {
    let id = token_id(tok);
    let leg = tok
        .split(':')
        .nth(1)
        .unwrap_or("0")
        .parse::<usize>()
        .unwrap();
    let old = rt.get("defs").array().get(id).cloned();
    if let Some(j) = &old {
        if j.get("legs").array()[leg..]
            .iter()
            .all(|e| leg_valid(plan, dirs, e))
        {
            return Some((j.clone(), leg, tok.into()));
        }
    }
    if let Some(j) = &old {
        let id = rt.get("defs").array().len();
        if let Some(next) = routing.route(j, station, id) {
            let id = next.num("id") as usize;
            if id == rt.get("defs").array().len() {
                rt.get_mut("defs").array_mut().push(next.clone());
            }
            return Some((next, 0, format!("{}:0:{}", id, since.floor() as i64)));
        }
    }
    if count > 0.0 {
        add(rt, "cancelled", count);
        add(rt, "rejected", count);
        rejected.push(object([
            ("journey", old.unwrap_or(V::Missing)),
            ("count", n(count)),
        ]));
    }
    None
}
pub(super) fn reconcile(v: &V) -> V {
    let mut rt = v.get("runtime").clone();
    let plan = v.get("plan");
    let previous = v.get("previous");
    let dirs = v.get("directions");
    let mut routing = Routing::new(v.get("graph").clone());
    let mut archives = rt.get("routeArchives").clone();
    if !archives.truth() {
        archives = obj()
    }
    let mut revision = rt.zero("nextRouteRevision");
    let mut versions = HashMap::new();
    for t in rt.get_mut("trains").array_mut() {
        let before = previous
            .get("services")
            .array()
            .iter()
            .find(|l| l.get("id").text() == t.get("service").text());
        let after = plan
            .get("services")
            .array()
            .iter()
            .find(|l| l.get("id").text() == t.get("service").text());
        if !t.get("retiringRun").truth() {
            if let Some(before) = before {
                let id = t.get("service").text().to_string();
                if after.is_none()
                    || v.get("oldSignatures").get(&id).text()
                        != v.get("newSignatures").get(&id).text()
                {
                    t.set("retiringRun", json_clone(before));
                    let key = versions.entry(id.clone()).or_insert_with(|| {
                        revision += 1.0;
                        let key = format!("r{}", revision as u64);
                        let tracks = previous
                            .get("tracks")
                            .array()
                            .iter()
                            .filter(|tr| {
                                before
                                    .get("trackIds")
                                    .array()
                                    .iter()
                                    .any(|id| id.text() == tr.get("id").text())
                            })
                            .cloned()
                            .collect();
                        archives.set(&key, object([("tracks", json_clone(&V::Array(tracks)))]));
                        key
                    });
                    t.set("retiringKey", text(key.clone()));
                }
            }
        }
    }
    if revision != rt.zero("nextRouteRevision") {
        rt.set("nextRouteRevision", n(revision));
    }
    let live = rt
        .get("trains")
        .array()
        .iter()
        .map(|t| t.get("retiringKey").text().to_string())
        .collect::<HashSet<_>>();
    archives = V::Object(
        archives
            .entries()
            .iter()
            .filter(|(k, _)| live.contains(k))
            .cloned()
            .collect(),
    );
    rt.set("routeArchives", archives);
    let needed = rt
        .get("trains")
        .array()
        .iter()
        .filter(|t| t.get("retiringRun").truth())
        .flat_map(|t| {
            t.get("trackIds")
                .array()
                .iter()
                .map(|x| x.text().to_string())
        })
        .collect::<HashSet<_>>();
    let retired = previous
        .get("tracks")
        .array()
        .iter()
        .filter(|t| {
            needed.contains(t.get("id").text())
                && !plan
                    .get("tracks")
                    .array()
                    .iter()
                    .any(|x| x.get("id").text() == t.get("id").text())
        })
        .cloned()
        .collect();
    rt.set("retiredTracks", V::Array(retired));
    rt.set("_routes", V::Null);
    rt.set("stationLimits", v.get("limits").clone());
    let mut catalog = v.get("catalog").clone();
    if catalog.truth() {
        if rt.get("defs").array().len() + catalog.array().len() > 55000 {
            compact(&mut rt);
        }
        for j in rt.get_mut("defs").array_mut() {
            j.set("daily", n(0.0));
        }
    } else {
        for j in rt.get_mut("defs").array_mut() {
            if !j
                .get("legs")
                .array()
                .iter()
                .all(|e| leg_valid(plan, dirs, e))
            {
                j.set("daily", n(0.0));
            }
        }
        if v.get("existingCatalog").truth() {
            catalog = V::Array(
                v.get("existingCatalog")
                    .array()
                    .iter()
                    .filter(|j| {
                        j.get("legs")
                            .array()
                            .iter()
                            .all(|e| leg_valid(plan, dirs, e))
                    })
                    .cloned()
                    .collect(),
            );
        }
    }
    let mut queues = obj();
    let mut waits = obj();
    let mut occupancy = obj();
    let mut rejected = vec![];
    let old_queues = rt.get("queues").clone();
    let old_waits = rt.get("waitSince").clone();
    for (k, q) in old_queues.entries() {
        let station = k.rsplit('|').next().unwrap().parse::<usize>().unwrap();
        for (tok, c) in q.entries() {
            let name = format!("{}#{}", k, tok);
            let val = old_waits.get(&name);
            let since = if matches!(val, V::Missing | V::Null) {
                rt.num("minute")
            } else {
                val.n()
            };
            if let Some((j, leg, tok)) = migrate(
                &mut rt,
                &mut routing,
                plan,
                dirs,
                tok,
                c.n(),
                station,
                since,
                &mut rejected,
            ) {
                let e = &j.get("legs").array()[leg];
                let key = format!(
                    "{}|{}|{}",
                    e.get("service").text(),
                    e.num("dir") as i32,
                    e.num("from") as usize
                );
                add(queues.get_mut(&key), &tok, c.n());
                let name = format!("{}#{}", key, tok);
                let prior = waits.num(&name);
                waits.set(
                    &name,
                    n(if prior.is_nan() {
                        since
                    } else {
                        prior.min(since)
                    }),
                );
                add(&mut occupancy, &station.to_string(), c.n());
            }
        }
    }
    rt.set("queues", queues);
    rt.set("waitSince", waits);
    let old_transfers = rt.get("transfers").clone();
    let mut transfers = vec![];
    for x in old_transfers.array() {
        let tok = format!("{}:{}", x.num("journey") as usize, x.num("leg") as usize);
        if let Some((j, leg, _)) = migrate(
            &mut rt,
            &mut routing,
            plan,
            dirs,
            &tok,
            x.num("amount"),
            x.num("station") as usize,
            x.num("ready") - 4.0,
            &mut rejected,
        ) {
            let mut next = x.clone();
            next.set("journey", j.get("id").clone());
            next.set("leg", n(leg as f64));
            transfers.push(next);
            add(
                &mut occupancy,
                &(x.num("station") as usize).to_string(),
                x.num("amount"),
            );
        }
    }
    rt.set("transfers", V::Array(transfers));
    rt.set("stationOccupancy", occupancy.clone());
    for (id, n) in occupancy.entries() {
        let l = rt.get_mut("stationLimits").get_mut(id);
        if l.truth() {
            l.set("capacity", V::Number(l.num("capacity").max(n.n())));
        }
    }
    let mut outside = obj();
    let mut since_map = obj();
    let old_outside = rt.get("outside").clone();
    let old_since = rt.get("outsideSince").clone();
    for (id, q) in old_outside.entries() {
        for (tok, c) in q.entries() {
            let name = format!("{}#{}", id, tok);
            let val = old_since.get(&name);
            let since = if matches!(val, V::Missing | V::Null) {
                rt.num("minute")
            } else {
                val.n()
            };
            if let Some((_, _, tok)) = migrate(
                &mut rt,
                &mut routing,
                plan,
                dirs,
                tok,
                c.n(),
                id.parse().unwrap(),
                since,
                &mut rejected,
            ) {
                add(outside.get_mut(id), &tok, c.n());
                let name = format!("{}#{}", id, tok);
                let prior = since_map.num(&name);
                since_map.set(
                    &name,
                    n(if prior.is_nan() {
                        since
                    } else {
                        prior.min(since)
                    }),
                );
            }
        }
    }
    for (id, q) in outside.entries() {
        let l = rt.get_mut("stationLimits").get_mut(id);
        if l.truth() {
            let count = q.entries().iter().fold(0.0, |v, (_, c)| v + c.n());
            l.set("outsideCapacity", n(l.num("outsideCapacity").max(count)));
        }
    }
    rt.set("outside", outside);
    rt.set("outsideSince", since_map);
    let minute = rt.num("minute");
    for (key, h) in v.get("headways").entries() {
        let h = h.n();
        let d = rt.get_mut("departures").get_mut(key);
        if !d.truth() {
            *d = object([("next", n(minute)), ("headway", n(h))]);
        } else if d.num("headway") != h {
            let last = if matches!(d.get("lastRun"), V::Missing | V::Null) {
                minute
            } else {
                d.num("lastRun")
            };
            d.set(
                "next",
                n(if h.is_finite() {
                    minute.max(d.num("next").min(last + h))
                } else {
                    f64::INFINITY
                }),
            );
            d.set("headway", n(h));
        }
    }
    rt.set("fleetMinute", n(-1.0));
    let routes = V::Array(
        routing
            .routes
            .iter()
            .map(|((from, to, purpose, fare), j)| {
                V::Array(vec![
                    n(*from as f64),
                    n(*to as f64),
                    text(purpose),
                    n(f64::from_bits(*fare)),
                    j.as_ref().map_or(V::Null, |j| j.get("id").clone()),
                ])
            })
            .collect(),
    );
    object([
        ("runtime", rt),
        ("catalog", catalog),
        ("rejected", V::Array(rejected)),
        ("routeCache", routes),
        (
            "trees",
            V::Array(
                routing
                    .trees
                    .iter()
                    .map(|((from, purpose), data)| {
                        V::Array(vec![
                            n(*from as f64),
                            text(purpose),
                            V::Array(data.iter().map(|x| n(*x)).collect()),
                        ])
                    })
                    .collect(),
            ),
        ),
    ])
}
pub(super) fn run(op: usize, v: &V) -> V {
    match op {
        23 => V::Array(
            v.get("journeys")
                .array()
                .iter()
                .map(|j| {
                    V::Bool(
                        j.array()
                            .iter()
                            .all(|e| leg_valid(v.get("plan"), v.get("directions"), e)),
                    )
                })
                .collect(),
        ),
        20 => {
            let mut rt = v.get("runtime").clone();
            compact(&mut rt);
            rt
        }
        21 => reconcile(v),
        22 => {
            let mut routing = Routing::new(v.get("graph").clone());
            let next = routing
                .route(
                    v.get("journey"),
                    v.num("from") as usize,
                    v.num("id") as usize,
                )
                .unwrap_or(V::Null);
            object([
                ("journey", next),
                (
                    "trees",
                    V::Array(
                        routing
                            .trees
                            .iter()
                            .map(|((from, purpose), data)| {
                                V::Array(vec![
                                    n(*from as f64),
                                    text(purpose),
                                    V::Array(data.iter().map(|x| n(*x)).collect()),
                                ])
                            })
                            .collect(),
                    ),
                ),
            ])
        }
        _ => panic!("unknown migration transaction"),
    }
}
