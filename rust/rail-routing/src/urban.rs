//! Cold urban transactions. Geography masks and UI labels are supplied as data.
use crate::demand::{hypot, raw_exp};
use crate::value::{object, Value as V};
const USES: [&str; 3] = ["r", "c", "i"];
const FIELDS: [&str; 5] = ["people", "jobs", "shops", "industry", "leisure"];
const KINDS: [&str; 8] = [
    "school",
    "hospital",
    "park",
    "university",
    "library",
    "sports",
    "exhibition",
    "logistics",
];
const AREA: f64 = (12.0 * 0.045) * (12.0 * 0.045);
fn n(v: f64) -> V {
    V::Number(v)
}
fn text(v: impl Into<String>) -> V {
    V::String(v.into())
}
fn obj() -> V {
    V::Object(vec![])
}
fn clamp(v: f64, a: f64, b: f64) -> f64 {
    v.max(a).min(b)
}
fn dist(a: &V, b: &V) -> f64 {
    hypot(a.num("x") - b.num("x"), a.num("y") - b.num("y")) * 0.045
}
fn add(v: &mut V, k: &str, x: f64) {
    let y = v.zero(k) + x;
    v.set(k, n(y));
}
fn ty<'a>(types: &'a V, f: &V, k: &str) -> f64 {
    types.get(f.get("kind").text()).get(k).array()[f.num("level") as usize - 1].n()
}
fn release(u: &V, p: &V) -> f64 {
    let age = ((u.num("lastMinute") - u.get("development").num("started")) / 1440.0).max(0.0)
        - p.num("startDay");
    if age < 0.0 {
        0.0
    } else {
        clamp(0.25 + 0.75 * age / 12.0, 0.0, 1.0)
    }
}
fn potential(u: &V, p: &V) -> [f64; 3] {
    let mut out: [f64; 3] = [0.08, 0.06, 0.08];
    for q in u.get("development").get("projects").array() {
        let r = release(u, q);
        if r == 0.0 {
            continue;
        }
        let km = dist(q, p);
        if km > q.num("radius") * 2.0 {
            continue;
        }
        let ratio = km / q.num("radius");
        let w = raw_exp(-2.0 * ratio * ratio) * r;
        let mix = match q.get("kind").text() {
            "residential" => [1.0, 0.35, 0.1],
            "business" => [0.35, 1.0, 0.12],
            "industry" => [0.3, 0.25, 1.0],
            _ => [0.8, 0.8, 0.2],
        };
        for i in 0..3 {
            out[i] = out[i].max(mix[i] * w);
        }
    }
    out
}
fn score(u: &V, p: &V, mut v: V) -> V {
    if !u.get("development").truth() {
        return v;
    }
    let land = potential(u, p);
    for (i, (field, a, b, market)) in [
        ("residential", 0.55, 0.42, "marketResidential"),
        ("commercial", 0.56, 0.44, "marketCommercial"),
        ("industrial", 0.58, 0.42, "marketIndustrial"),
    ]
    .iter()
    .enumerate()
    {
        let x = clamp(v.num(field) * a + land[i] * b, 0.0, 1.0);
        v.set(field, n(x));
        v.set(market, n(land[i]));
    }
    v
}
fn budgets(u: &V) -> [f64; 3] {
    let t = u.get("totals");
    let people = t.zero("people");
    let jobs = t.zero("jobs");
    [
        (2500.0 + (people + 1.0).sqrt() * 9.0 + (jobs + 1.0).sqrt() * 6.0).min(30000.0)
            * clamp((jobs + 6000.0) / (people * 0.42 + 1.0), 0.1, 1.0),
        (1200.0 + (people + 1.0).sqrt() * 5.0).min(15000.0)
            * clamp((people * 0.38 + 5000.0) / (jobs + 1.0), 0.15, 1.0),
        (500.0 + (people + 1.0).sqrt() * 3.0).min(8000.0)
            * clamp((people * 0.3 + 5000.0) / (jobs + 1.0), 0.15, 1.0),
    ]
}
fn allocate(u: &mut V, before: &V, updates: &mut V) -> V {
    let daily = budgets(u);
    let mut added = [0.0; 3];
    let prior = before
        .entries()
        .iter()
        .map(|(k, c)| (k.as_str(), c))
        .collect::<std::collections::HashMap<_, _>>();
    let V::Object(rows) = updates else {
        unreachable!()
    };
    for i in 0..3 {
        let k = USES[i];
        let field = ["residential", "commercial", "industrial"][i];
        let market = ["marketResidential", "marketCommercial", "marketIndustrial"][i];
        let mut items = vec![];
        for (ix, (key, c)) in rows.iter_mut().enumerate() {
            let old = prior.get(key.as_str()).map_or(0.0, |c| c.zero(k));
            let want = (c.num(k) - old).max(0.0);
            c.set(k, n(old));
            if want > 0.0 {
                let sc = c.get("scores").zero(field);
                let weight = want * pow(sc, 3.0).max(0.005) * (0.2 + c.get("scores").zero(market));
                items.push((ix, want, weight));
            }
        }
        let mut budget = daily[i] / 4.0;
        for _ in 0..5 {
            if budget <= 1e-7 {
                break;
            }
            let sum = items
                .iter()
                .filter(|x| x.1 > 1e-8)
                .fold(0.0, |v, x| v + x.2);
            if sum == 0.0 {
                break;
            }
            let available = budget;
            for (ix, left, weight) in &mut items {
                if *left <= 1e-8 {
                    continue;
                }
                let v = left.min(available * *weight / sum);
                add(&mut rows[*ix].1, k, v);
                *left -= v;
                budget -= v;
                added[i] += v;
            }
        }
    }
    let values = |a: [f64; 3]| {
        V::Object(
            USES.iter()
                .enumerate()
                .map(|(i, k)| (k.to_string(), n(a[i])))
                .collect(),
        )
    };
    let minute = u.num("lastMinute") + 360.0;
    u.get_mut("development").set(
        "last",
        object([
            ("minute", n(minute)),
            ("daily", values(daily)),
            ("added", values(added)),
        ]),
    );
    values(added)
}
fn auto(u: &mut V, types: &V, minute: f64) {
    if u.get("facilityMode").text() != "automatic" {
        return;
    }
    let people = u
        .get("cells")
        .entries()
        .iter()
        .fold(0.0, |v, (_, c)| v + c.num("r"));
    let target =
        (48 + (people / 18000.0).floor() as usize).min(u.get("autoCandidates").array().len());
    let mut changed = false;
    let candidates = u.get("autoCandidates").array()[..target].to_vec();
    for (i, p) in candidates.iter().enumerate() {
        if u.get("facilities").array().len() >= 160 {
            break;
        }
        if u.get("facilities").array().iter().any(|f| {
            f.num("autoKey") == i as f64
                || f.get("kind").text() == p.get("kind").text() && dist(f, p) < 0.4
        }) {
            continue;
        }
        let id = u.num("nextId");
        let f = object([
            ("id", text(format!("u{}", id as u64))),
            ("kind", p.get("kind").clone()),
            ("level", p.get("level").clone()),
            ("x", p.get("x").clone()),
            ("y", p.get("y").clone()),
            (
                "name",
                text(format!(
                    "{} · {}",
                    p.get("name").text(),
                    types.get(p.get("kind").text()).get("name").text()
                )),
            ),
            ("system", V::Bool(true)),
            ("autoKey", n(i as f64)),
            ("opened", n(minute)),
        ]);
        u.get_mut("facilities").array_mut().push(f);
        u.set("nextId", n(id + 1.0));
        changed = true;
    }
    let cells = u.get("cells").clone();
    for f in u.get_mut("facilities").array_mut() {
        let radius = ty(types, f, "radius");
        let local = cells.entries().iter().fold(0.0, |v, (_, c)| {
            v + if dist(c, f) < radius { c.num("r") } else { 0.0 }
        });
        let level = if local > 40000.0 {
            3.0
        } else if local > 10000.0 {
            2.0
        } else {
            1.0
        };
        if level > f.num("level") {
            f.set("level", n(level));
            changed = true
        }
    }
    if changed {
        add(u, "revision", 1.0)
    }
}
fn stations(s: &V) -> Vec<V> {
    let mut ids = vec![];
    for l in s.get("services").array() {
        for id in l.get("stops").array() {
            let id = id.n() as usize;
            if !ids.contains(&id) {
                ids.push(id)
            }
        }
    }
    ids.into_iter()
        .map(|id| {
            let lines = s
                .get("services")
                .array()
                .iter()
                .filter(|l| l.get("stops").array().iter().any(|x| x.n() == id as f64))
                .collect::<Vec<_>>();
            let mut neighbors = vec![];
            let mut operated = false;
            for l in &lines {
                for x in l.get("stops").array() {
                    let x = x.n() as usize;
                    if !neighbors.contains(&x) {
                        neighbors.push(x)
                    }
                }
                let d = l.get("dispatch");
                if !l.get("fleetManaged").truth()
                    || if d.get("mode").text() == "auto" {
                        d.num("offPeak").max(d.num("peak"))
                    } else {
                        d.num("manual")
                    } > 0.0
                {
                    operated = true
                }
            }
            let mut out = s.get("nodes").array()[id].clone();
            out.set("connections", n(neighbors.len() as f64 - 1.0));
            out.set("interchange", n((lines.len() as f64 - 1.0).max(0.0)));
            out.set("service", n(if operated { 1.0 } else { 0.3 }));
            out
        })
        .collect()
}
struct Context {
    stations: Vec<V>,
    facilities: Vec<V>,
    bins: std::collections::HashMap<(i64, i64), Vec<V>>,
}
fn context(s: &V, u: &V, types: &V) -> Context {
    let mut bins = std::collections::HashMap::<(i64, i64), Vec<V>>::new();
    for (_, c) in u.get("cells").entries() {
        bins.entry((
            (c.num("x") / 30.0).floor() as i64,
            (c.num("y") / 30.0).floor() as i64,
        ))
        .or_default()
        .push(c.clone());
    }
    let facilities = u
        .get("facilities")
        .array()
        .iter()
        .map(|f| {
            let radius = ty(types, f, "radius");
            let local = u.get("cells").entries().iter().fold(0.0, |v, (_, c)| {
                v + if dist(c, f) <= radius {
                    c.num("r")
                } else {
                    0.0
                }
            });
            let t = types.get(f.get("kind").text());
            let rate = if t.get("needRate").truth() {
                t.num("needRate")
            } else {
                match f.get("kind").text() {
                    "school" => 0.12,
                    "hospital" => 0.025,
                    _ => 0.05,
                }
            };
            let need = local * rate;
            let mut out = f.clone();
            out.set("radius", n(radius));
            out.set(
                "quality",
                n((ty(types, f, "capacity") / need.max(1.0)).min(1.0)),
            );
            out
        })
        .collect();
    Context {
        stations: stations(s),
        facilities,
        bins,
    }
}
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "rail_math")]
extern "C" {
    #[link_name = "sin"]
    fn host_sin(v: f64) -> f64;
    #[link_name = "log1p"]
    fn host_log1p(v: f64) -> f64;
    #[link_name = "pow"]
    fn host_pow(a: f64, b: f64) -> f64;
}
fn pow(a: f64, b: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return host_pow(a, b);
    }
    #[cfg(not(target_arch = "wasm32"))]
    a.powf(b)
}
fn sin(v: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return host_sin(v);
    }
    #[cfg(not(target_arch = "wasm32"))]
    v.sin()
}
fn log1p(v: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return host_log1p(v);
    }
    #[cfg(not(target_arch = "wasm32"))]
    v.ln_1p()
}
fn zone(u: &V, p: &V, ctx: &Context, hubs: &V) -> V {
    let mut out = obj();
    for k in [
        "residential",
        "commercial",
        "industrial",
        "rail",
        "amenities",
        "hub",
    ]
    .iter()
    .chain(KINDS.iter())
    {
        out.set(k, n(0.0));
    }
    let (mut rail, mut interchange, mut network) = (0.0_f64, 0.0_f64, 0.0_f64);
    for st in &ctx.stations {
        let d = dist(p, st);
        if d > 3.2 {
            continue;
        }
        let v = raw_exp(-d / 0.9);
        rail = rail.max(v * (0.72 + 0.28 * st.num("service")));
        interchange = interchange.max(v * (st.num("interchange") / 2.0).min(1.0));
        network = network.max(v * (st.num("connections") / 12.0).min(1.0));
    }
    let (mut residents, mut commercial, mut industry) = (0.0, 0.0, 0.0);
    let x = (p.num("x") / 30.0).floor() as i64;
    let y = (p.num("y") / 30.0).floor() as i64;
    for a in x - 1..=x + 1 {
        for b in y - 1..=y + 1 {
            if let Some(cells) = ctx.bins.get(&(a, b)) {
                for c in cells {
                    if dist(c, p) < 1.2 {
                        residents += c.num("r");
                        commercial += c.num("c");
                        industry += c.num("i");
                    }
                }
            }
        }
    }
    let population = clamp(residents / 22000.0, 0.0, 1.0);
    let jobs = clamp((commercial + industry) / 12000.0, 0.0, 1.0);
    let agglomeration = clamp((residents + commercial) / 45000.0, 0.0, 1.0);
    for f in &ctx.facilities {
        let d = dist(p, f);
        let radius = f.num("radius");
        if d > radius {
            continue;
        }
        let v = (1.0 - d / radius) * (0.4 + 0.6 * f.num("quality"));
        let k = f.get("kind").text();
        out.set(k, n(out.num(k).max(v)));
    }
    let (mut hub, mut freight) = (0.0_f64, 0.0_f64);
    for h in hubs.array() {
        let v = raw_exp(-dist(h, p) / 1.5) * clamp(log1p(h.num("daily")) / 13.0, 0.0, 1.0);
        hub = hub.max(v);
        if ["port", "airport", "rail"].contains(&h.get("type").text()) {
            freight = freight.max(v)
        }
    }
    let amenity = clamp(
        out.num("school") * 0.75 + out.num("hospital") * 0.6 + out.num("park") * 0.65,
        0.0,
        1.0,
    );
    let pollution = clamp(industry / 10000.0, 0.0, 1.0);
    let noise = (sin(p.num("x") * 12.9898 + p.num("y") * 78.233) * 43758.5453) % 1.0 * 0.025;
    out.set("rail", n(rail));
    out.set("amenities", n(amenity));
    out.set("hub", n(hub));
    let r = clamp(
        (out.num("university") * 0.24 + out.num("library") * 0.18 + out.num("sports") * 0.12)
            .min(0.35)
            - out.num("logistics") * 0.16
            + 0.26
            + 0.43 * rail
            + 0.13 * network
            + 0.45 * amenity
            + 0.10 * jobs
            + 0.08 * agglomeration
            - 0.18 * pollution
            + noise,
        0.0,
        1.0,
    );
    let c = clamp(
        (out.num("exhibition") * 0.30
            + out.num("library") * 0.15
            + out.num("sports") * 0.22
            + out.num("university") * 0.16)
            .min(0.4)
            + 0.14
            + 0.44 * rail
            + 0.18 * population
            + 0.18 * interchange
            + 0.20 * hub
            + 0.12 * agglomeration
            + 0.12 * (out.num("school") + out.num("hospital"))
            + noise,
        0.0,
        1.0,
    );
    let i = clamp(
        (out.num("logistics") * 0.35 + out.num("university") * 0.08).min(0.4)
            + 0.22
            + 0.20 * rail
            + 0.23 * freight
            + 0.16 * population
            + 0.12 * (1.0 - rail)
            - 0.19 * amenity
            - 0.17 * interchange
            - 0.10 * hub
            + noise,
        0.0,
        1.0,
    );
    out.set("residential", n(r));
    out.set("commercial", n(c));
    out.set("industrial", n(i));
    score(u, p, out)
}
fn candidate_points(s: &V, u: &V, types: &V) -> V {
    let mut keys = std::collections::HashSet::new();
    let mut points = vec![];
    let mut anchors = stations(s);
    for a in &mut anchors {
        a.set("radius", n(2.2));
    }
    for f in u.get("facilities").array() {
        let mut a = f.clone();
        a.set(
            "radius",
            n(if u.get("facilityMode").text() == "automatic" {
                1.1
            } else {
                ty(types, f, "radius") + 0.6
            }),
        );
        anchors.push(a);
    }
    for p in u.get("development").get("projects").array() {
        if release(u, p) > 0.0 {
            anchors.push(p.clone());
        }
    }
    for a in &anchors {
        let radius = a.num("radius");
        let x = (a.num("x") / 12.0).floor() as i64;
        let y = (a.num("y") / 12.0).floor() as i64;
        let r = (radius / 0.045 / 12.0).ceil() as i64;
        for i in x - r..=x + r {
            for j in y - r..=y + r {
                let p = object([
                    ("x", n((i as f64 + 0.5) * 12.0)),
                    ("y", n((j as f64 + 0.5) * 12.0)),
                ]);
                if dist(a, &p) <= radius && keys.insert((i, j)) {
                    points.push(p);
                }
            }
        }
    }
    V::Array(points)
}
fn city(u: &V, types: &V, metadata: &V) -> V {
    let mut cells = vec![];
    let mut ids = std::collections::HashMap::new();
    for (id, c) in u.get("cells").entries() {
        let mut row = object([("id", text(id))]);
        for (k, v) in c.entries() {
            row.set(k, v.clone());
        }
        for (k, v) in [
            ("w", 12.0),
            ("h", 12.0),
            ("area", AREA),
            ("people", c.num("r")),
            ("jobs", c.num("c") + c.num("i")),
            ("shops", c.num("c") * 0.45 + c.num("r") * 0.035),
            ("industry", c.num("i")),
            ("leisure", c.num("r") * 0.07 + c.num("c") * 0.12),
            ("factory", c.num("i") / 18000.0),
            ("survey", 1.0),
        ] {
            row.set(k, n(v));
        }
        row.set("populationValid", V::Bool(true));
        row.set("modelled", V::Bool(true));
        ids.insert(id.clone(), cells.len());
        cells.push(row);
    }
    for f in u.get("facilities").array() {
        let x = (f.num("x") / 12.0).floor();
        let y = (f.num("y") / 12.0).floor();
        let id = format!("{}:{}", x as i64, y as i64);
        let ix = if let Some(&i) = ids.get(&id) {
            i
        } else {
            let mut row = object([
                ("id", text(id.clone())),
                ("x", n((x + 0.5) * 12.0)),
                ("y", n((y + 0.5) * 12.0)),
                ("w", n(12.0)),
                ("h", n(12.0)),
                ("area", n(AREA)),
            ]);
            for k in ["people", "jobs", "shops", "industry", "leisure", "factory"] {
                row.set(k, n(0.0));
            }
            row.set("survey", n(1.0));
            row.set("populationValid", V::Bool(true));
            row.set("modelled", V::Bool(true));
            let i = cells.len();
            cells.push(row);
            ids.insert(id, i);
            i
        };
        add(&mut cells[ix], "jobs", ty(types, f, "jobs"));
        add(&mut cells[ix], "leisure", ty(types, f, "visits"));
    }
    let mut totals = obj();
    for k in FIELDS {
        totals.set(k, n(cells.iter().fold(0.0, |v, c| v + c.num(k))));
    }
    let mut meta = metadata.clone();
    meta.set("demandZoneUnits", n(80.0));
    meta.set("populationSum", totals.get("people").clone());
    meta.set("growthModel", V::Bool(true));
    meta.set(
        "effectiveConnections",
        V::Bool(u.get("development").truth()),
    );
    meta.set("populationKind", text("轨道与市政驱动的动态模拟人口"));
    object([
        ("cells", V::Array(cells)),
        ("totals", totals),
        ("cell", n(12.0)),
        ("area", n(AREA)),
        ("metadata", meta),
    ])
}
fn facility_patch(u: &V) -> V {
    object([
        ("facilities", u.get("facilities").clone()),
        ("nextId", u.get("nextId").clone()),
        ("revision", u.get("revision").clone()),
    ])
}
fn compact_city(mut view: V, u: &V) -> V {
    let inherited = u
        .get("cells")
        .entries()
        .iter()
        .map(|(id, c)| (id.as_str(), c))
        .collect::<std::collections::HashMap<_, _>>();
    for c in view.get_mut("cells").array_mut() {
        let id = c.get("id").text().to_string();
        if let Some(old) = inherited.get(id.as_str()) {
            if let V::Object(fields) = c {
                fields.retain(|(k, _)| {
                    [
                        "id",
                        "w",
                        "h",
                        "area",
                        "people",
                        "jobs",
                        "shops",
                        "industry",
                        "leisure",
                        "factory",
                        "survey",
                        "populationValid",
                        "modelled",
                    ]
                    .contains(&k.as_str())
                        || matches!(old.get(k), V::Missing)
                });
            }
        }
    }
    view
}
pub(super) fn run(op: usize, v: &V) -> V {
    let s = v.get("state");
    let mut u = s.get("urban").clone();
    let types = v.get("types");
    match op {
        0 => {
            auto(&mut u, types, s.get("economy").get("minute").n());
            let points = candidate_points(s, &u, types);
            object([("urban", facility_patch(&u)), ("points", points)])
        }
        1 => {
            let ctx = context(s, &u, types);
            let before = u.get("cells").clone();
            let prior = before
                .entries()
                .iter()
                .map(|(k, v)| (k.as_str(), v))
                .collect::<std::collections::HashMap<_, _>>();
            let mut update_rows = vec![];
            let mut growth = 0.0;
            for key in v.get("keys").array() {
                let key = key.text();
                let old = if let Some(c) = prior.get(key) {
                    (*c).clone()
                } else {
                    let xy = key
                        .split(':')
                        .map(|x| x.parse::<f64>().unwrap())
                        .collect::<Vec<_>>();
                    object([
                        ("x", n((xy[0] + 0.5) * 12.0)),
                        ("y", n((xy[1] + 0.5) * 12.0)),
                        ("r", n(0.0)),
                        ("c", n(0.0)),
                        ("i", n(0.0)),
                    ])
                };
                let scores = zone(&u, &old, &ctx, v.get("hubs"));
                let near = scores.num("rail") > 0.08;
                let amenity =
                    scores.num("amenities") > 0.12 || KINDS.iter().any(|k| scores.num(k) > 0.1);
                if !near
                    && !amenity
                    && !old.get("r").truth()
                    && !old.get("c").truth()
                    && !old.get("i").truth()
                    && !(u.get("development").truth()
                        && ["marketResidential", "marketCommercial", "marketIndustrial"]
                            .iter()
                            .any(|k| scores.num(k) > 0.1))
                {
                    continue;
                }
                let phase = |v: f64| {
                    if v < 0.40 {
                        0
                    } else if v < 0.59 {
                        1
                    } else if v < 0.73 {
                        2
                    } else if v < 0.86 {
                        3
                    } else {
                        4
                    }
                };
                let levels = [
                    phase(scores.num("residential")),
                    phase(scores.num("commercial")),
                    phase(scores.num("industrial")),
                ];
                let targets = [
                    [0.0, 5000.0, 14000.0, 36000.0, 60000.0][levels[0]]
                        * AREA
                        * if near { 1.0 } else { 0.4 },
                    [0.0, 2800.0, 12000.0, 36000.0, 70000.0][levels[1]]
                        * AREA
                        * if near { 1.0 } else { 0.2 },
                    [0.0, 2000.0, 5500.0, 11000.0, 18000.0][levels[2]] * AREA * 0.55,
                ];
                let mut next = old.clone();
                next.set("scores", scores);
                next.set(
                    "levels",
                    V::Object(
                        USES.iter()
                            .enumerate()
                            .map(|(i, k)| (k.to_string(), n(levels[i] as f64)))
                            .collect(),
                    ),
                );
                next.set("age", n(old.zero("age") + 1.0));
                for i in 0..3 {
                    let prior = old.num(USES[i]);
                    let delta = if targets[i] >= prior {
                        (targets[i] - prior) * if i == 0 { 0.09 } else { 0.065 }
                    } else {
                        -(prior - targets[i])
                            * if u.get("development").truth() {
                                0.0
                            } else {
                                0.015
                            }
                    };
                    next.set(USES[i], n((prior + delta).max(0.0)));
                    growth += delta.max(0.0);
                }
                if next.num("r") + next.num("c") + next.num("i") > 0.1 {
                    update_rows.push((key.to_string(), next));
                }
            }
            let mut updates = V::Object(update_rows);
            if u.get("development").truth() {
                allocate(&mut u, &before, &mut updates);
            }
            u.set("cells", updates);
            add(&mut u, "step", 1.0);
            add(&mut u, "lastMinute", 360.0);
            add(&mut u, "revision", 1.0);
            let view = city(&u, types, v.get("metadata"));
            u.set("totals", view.get("totals").clone());
            if u.num("step") % 4.0 == 0.0 {
                let mut row = object([("day", n(u.num("step") / 4.0))]);
                for (k, v) in u.get("totals").entries() {
                    row.set(k, v.clone());
                }
                row.set("districts", n(u.get("cells").entries().len() as f64));
                let h = u.get_mut("history").array_mut();
                h.push(row);
                if h.len() > 60 {
                    h.remove(0);
                }
            }
            let view = compact_city(view, &u);
            object([("urban", u), ("city", view), ("growth", n(growth))])
        }
        2 => zone(&u, v.get("point"), &context(s, &u, types), v.get("hubs")),
        3 => compact_city(city(&u, types, v.get("metadata")), &u),
        4 => {
            auto(&mut u, types, s.get("economy").get("minute").n());
            facility_patch(&u)
        }
        5 => {
            let p = v.get("point");
            let day =
                ((u.num("lastMinute") - u.get("development").num("started")) / 1440.0).max(0.0);
            let age = day - p.num("startDay");
            object([
                ("day", n(day)),
                ("age", n(age)),
                ("release", n(release(&u, p))),
                ("until", n((-age).ceil().max(0.0))),
            ])
        }
        6 => {
            let x = potential(&u, v.get("point"));
            V::Object(
                USES.iter()
                    .enumerate()
                    .map(|(i, k)| (k.to_string(), n(x[i])))
                    .collect(),
            )
        }
        7 => score(&u, v.get("point"), v.get("scores").clone()),
        8 => {
            let x = budgets(&u);
            V::Object(
                USES.iter()
                    .enumerate()
                    .map(|(i, k)| (k.to_string(), n(x[i])))
                    .collect(),
            )
        }
        9 => {
            let mut updates = v.get("updates").clone();
            let added = allocate(&mut u, v.get("before"), &mut updates);
            object([
                ("updates", updates),
                ("added", added),
                ("last", u.get("development").get("last").clone()),
            ])
        }
        10 => {
            let preferred = if v.get("region").text() == "gba" {
                vec![
                    "福田",
                    "天河",
                    "科技园",
                    "松山湖",
                    "宝安中心",
                    "南沙",
                    "禅城",
                    "横琴",
                    "沙田",
                    "江北",
                    "石岐",
                    "新会",
                ]
            } else {
                vec![
                    "新宿",
                    "渋谷",
                    "池袋",
                    "横浜",
                    "大宮",
                    "千葉",
                    "立川",
                    "町田",
                    "川崎",
                    "柏",
                    "八王子",
                    "船橋",
                ]
            };
            let mut source = v
                .get("places")
                .array()
                .iter()
                .filter(|p| !v.get("hubs").array().iter().any(|h| dist(h, p) < 0.8))
                .cloned()
                .collect::<Vec<_>>();
            source.sort_by_key(|p| {
                preferred
                    .iter()
                    .position(|name| *name == p.get("name").text())
                    .unwrap_or(999)
            });
            let mut chosen = vec![];
            for p in source {
                if chosen.len() == 12 {
                    break;
                }
                if chosen.iter().any(|q| dist(q, &p) < 3.2) {
                    continue;
                }
                chosen.push(p);
            }
            let projects = chosen
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    let name = p.get("name").text();
                    let kind = if ["科技", "天河", "渋谷", "新宿", "江北"]
                        .iter()
                        .any(|x| name.contains(x))
                    {
                        "business"
                    } else if ["松山湖", "南沙", "川崎", "千葉"]
                        .iter()
                        .any(|x| name.contains(x))
                    {
                        "industry"
                    } else if i % 2 == 1 {
                        "mixed"
                    } else {
                        "residential"
                    };
                    object([
                        ("id", text(format!("dev{}", i))),
                        ("name", p.get("name").clone()),
                        ("kind", text(kind)),
                        ("x", p.get("x").clone()),
                        ("y", p.get("y").clone()),
                        ("radius", n(2.4 + (i % 3) as f64 * 0.45)),
                        (
                            "startDay",
                            n((((i as f64 - 1.0) / 3.0).floor().max(0.0)) * 4.0),
                        ),
                    ])
                })
                .collect();
            object([
                ("version", n(35.0)),
                ("started", u.get("lastMinute").clone()),
                ("projects", V::Array(projects)),
                ("last", V::Null),
            ])
        }
        11 => {
            let mut source = v.get("places").array().to_vec();
            let mut anchors = vec![];
            while !source.is_empty() && anchors.len() < 96 {
                let mut best = 0;
                let mut score = -1.0;
                if !anchors.is_empty() {
                    for (i, p) in source.iter().enumerate() {
                        let d = anchors.iter().fold(f64::INFINITY, |v, a| v.min(dist(a, p)));
                        if d > score {
                            score = d;
                            best = i
                        }
                    }
                    if score < 2.4 {
                        break;
                    }
                }
                anchors.push(source.remove(best));
            }
            V::Array(
                anchors
                    .into_iter()
                    .enumerate()
                    .map(|(i, mut p)| {
                        p.set("kind", text(KINDS[i % KINDS.len()]));
                        p.set("level", n(if i % 11 == 0 { 2.0 } else { 1.0 }));
                        p
                    })
                    .collect(),
            )
        }
        12 => candidate_points(s, &u, types),
        13 => V::Array(stations(s)),
        14 => {
            let f = v.get("facility");
            let radius = ty(types, f, "radius");
            let population = u.get("cells").entries().iter().fold(0.0, |v, (_, c)| {
                v + if dist(c, f) <= radius {
                    c.num("r")
                } else {
                    0.0
                }
            });
            let kind = f.get("kind").text();
            let t = types.get(kind);
            let rate = if matches!(t.get("needRate"), V::Missing | V::Null) {
                match kind {
                    "school" => 0.12,
                    "hospital" => 0.025,
                    _ => 0.05,
                }
            } else {
                t.num("needRate")
            };
            let need = population * rate;
            let capacity = ty(types, f, "capacity");
            object([
                ("radius", n(radius)),
                ("capacity", n(capacity)),
                ("population", n(population)),
                ("need", n(need)),
                ("load", n(need / capacity)),
                (
                    "upkeep",
                    n(if f.get("system").truth() {
                        0.0
                    } else {
                        ty(types, f, "price") * 0.001
                    }),
                ),
            ])
        }
        15 => {
            let f = v.get("facility");
            let mut near = stations(s)
                .into_iter()
                .map(|st| {
                    object([
                        ("id", st.get("id").clone()),
                        ("walk", n(dist(&st, f) * 1.25)),
                        ("service", st.get("service").clone()),
                    ])
                })
                .collect::<Vec<_>>();
            near.sort_by(|a, b| a.num("walk").total_cmp(&b.num("walk")));
            let nearest = near.first().cloned().unwrap_or(V::Null);
            let linked = near
                .into_iter()
                .filter(|st| st.num("walk") <= 0.8 && st.num("service") == 1.0)
                .collect::<Vec<_>>();
            let demand = ty(types, f, "visits") + ty(types, f, "jobs") * 1.04;
            let priority = demand * if linked.is_empty() { 1.0 } else { 0.0 }
                / (1.0 + nearest.zero("walk") / 4.0);
            object([
                ("nearest", nearest),
                ("connected", V::Bool(!linked.is_empty())),
                ("linked", V::Array(linked)),
                ("demand", n(demand)),
                ("priority", n(priority)),
            ])
        }
        _ => panic!("unknown urban transaction"),
    }
}
