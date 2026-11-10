//! Atomic network editor. The host sends a small model snapshot, never city/queue/history state.
use super::{editor_geometry as G, editor_support::*};
use crate::{
    queues::Read,
    value::{self, Value as V},
    CORE,
};
use std::cell::RefCell;
thread_local! {static CONFIG:RefCell<Option<V>>=const{RefCell::new(None)};}
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "rail_math")]
extern "C" {
    #[link_name = "random"]
    fn host_random() -> f64;
    #[link_name = "sin"]
    fn host_sin(x: f64) -> f64;
}
fn random() -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return host_random();
    }
    #[cfg(not(target_arch = "wasm32"))]
    0.5
}
fn sin(x: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return host_sin(x);
    }
    #[cfg(not(target_arch = "wasm32"))]
    x.sin()
}
const COLORS: [&str; 6] = [
    "#4479cf", "#159781", "#d18150", "#a26bc4", "#d25d80", "#789641",
];
const COPY_FIELDS: [&str; 10] = [
    "fleet",
    "cars",
    "headway",
    "open",
    "close",
    "name",
    "color",
    "fareBands",
    "patterns",
    "loopDirection",
];
type Res<T> = Result<T, String>;
fn error(s: &str) -> String {
    s.into()
}
fn named(s: &V, p: &V, seed: f64, except: &V, cfg: &V) -> Res<V> {
    let region = if s.get("region").truth() {
        s.get("region").text()
    } else {
        "tokyo"
    };
    let mut candidates = cfg
        .get("places")
        .get(region)
        .array()
        .iter()
        .map(|v| (v, G::distance(v, p)))
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let (closest, km) = *candidates.first().ok_or("站名数据未就绪。")?;
    let near = candidates
        .iter()
        .filter(|r| r.1 <= min(km + 0.7, max(1.2, km)))
        .take(4)
        .collect::<Vec<_>>();
    let dice = (sin(seed * 9283.31) * 43758.5453).abs() % 1.0;
    let chosen = near
        .get((dice * near.len() as f64).floor() as usize)
        .map_or(closest, |r| r.0);
    let base = chosen.get("name").text();
    let used = s
        .get("nodes")
        .array()
        .iter()
        .filter(|n| !eq(n.get("id"), except) && matches!(n.get("mergedInto"), V::Missing))
        .map(|n| n.get("name"))
        .collect::<Vec<_>>();
    let exists = |name: &str| used.iter().any(|n| n.text() == name);
    let mut name = base.to_string();
    if exists(base) {
        let dx = p.num("x") - chosen.num("x");
        let dy = p.num("y") - chosen.num("y");
        let dir = format!(
            "{}{}",
            if dx < -0.5 {
                "西"
            } else if dx > 0.5 {
                "东"
            } else {
                ""
            },
            if dy < -0.5 {
                "北"
            } else if dy > 0.5 {
                "南"
            } else {
                ""
            }
        );
        let mut suffixes = vec![if dir.is_empty() { "中心" } else { &dir }];
        suffixes.extend([
            "东", "南", "西", "北", "东北", "东南", "西北", "西南", "中心",
        ]);
        if let Some(suffix) = suffixes
            .into_iter()
            .find(|suffix| !exists(&format!("{base}{suffix}")))
        {
            name = format!("{base}{suffix}");
        } else {
            let mut i = 2;
            while exists(&format!("{base}·{i}")) {
                i += 1;
            }
            name = format!("{base}·{i}");
        }
    }
    Ok(obj(&[
        ("name", text(&name)),
        ("source", text("nearby-place")),
        ("place", text(base)),
        ("distance", n(G::distance(chosen, p))),
    ]))
}
pub(super) fn snap(s: &V, p: &V) -> V {
    if integer(p) {
        return p.clone();
    }
    let mut best = V::Null;
    let mut d = 0.06;
    for node in s.get("nodes").array() {
        if !matches!(node.get("mergedInto"), V::Missing) {
            continue;
        }
        let km = G::distance(node, p);
        if km <= d {
            d = km;
            best = node.get("id").clone();
        }
    }
    best
}
fn create_node(s: &mut V, p: &V, cfg: &V) -> Res<V> {
    if integer(p) {
        let node = at(s.get("nodes"), p);
        if matches!(node, V::Missing) {
            return Err(error("车站不存在。"));
        }
        return Ok(if matches!(node.get("mergedInto"), V::Missing | V::Null) {
            p.clone()
        } else {
            node.get("mergedInto").clone()
        });
    }
    let width = fallback(s.get("world").get("width"), 1040.0);
    let height = fallback(s.get("world").get("height"), 740.0);
    if !p.truth()
        || !finite(p.get("x"))
        || !finite(p.get("y"))
        || p.num("x") < 25.0
        || p.num("x") > width - 25.0
        || p.num("y") < 25.0
        || p.num("y") > height - 25.0
    {
        return Err(error("请在地图范围内设置车站。"));
    }
    let close = snap(s, p);
    if !matches!(close, V::Null) {
        return Ok(close);
    }
    if s.get("nodes")
        .array()
        .iter()
        .filter(|p| matches!(p.get("mergedInto"), V::Missing))
        .count()
        >= if s.get("region").truth() { 400 } else { 200 }
    {
        return Err(error("测试地图最多支持 400 个车站。"));
    }
    let id = n(s.get("nodes").array().len() as f64);
    let seed = if matches!(p.get("nameSeed"), V::Missing | V::Null) {
        random()
    } else {
        num(p.get("nameSeed"))
    };
    let naming = named(s, p, seed, &V::Null, cfg)?;
    s.get_mut("nodes").array_mut().push(obj(&[
        ("id", id.clone()),
        ("name", naming.get("name").clone()),
        ("nameSource", naming.get("source").clone()),
        ("nearbyPlace", naming.get("place").clone()),
        ("x", n((p.num("x") * 1000.0 + 0.5).floor() / 1000.0)),
        ("y", n((p.num("y") * 1000.0 + 0.5).floor() / 1000.0)),
        ("type", text("住宅")),
        ("people", n(2200.0)),
        ("jobs", n(500.0)),
        ("housing", n(8000.0)),
        ("growth", n(0.0)),
        ("initialPeople", n(2200.0)),
        ("initialJobs", n(500.0)),
    ]));
    Ok(id)
}
fn next_id(s: &mut V, prefix: &str) -> V {
    let id = s.num("nextId");
    s.set("nextId", n(id + 1.0));
    text(&format!("{prefix}{}", jsstring(&n(id))))
}
fn corridor(t: &V, a: &V, b: &V) -> bool {
    eq(t.get("a"), a) && eq(t.get("b"), b) || eq(t.get("a"), b) && eq(t.get("b"), a)
}
fn raw_xy(p: &[V]) -> Vec<V> {
    p.iter().map(G::xy).collect()
}
fn same_shape(a: &[V], b: &[V]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| same(a.get("x"), b.get("x")) && same(a.get("y"), b.get("y")))
}
fn prune(s: &mut V) {
    let used = s
        .get("services")
        .array()
        .iter()
        .flat_map(|l| l.get("trackIds").array().iter().cloned())
        .collect::<Vec<_>>();
    s.get_mut("tracks")
        .array_mut()
        .retain(|t| used.iter().any(|id| same(id, t.get("id"))));
}
fn route(s: &mut V, li: usize, stops: Vec<V>, shapes: V) -> Res<()> {
    let mut l = s.get("services").array()[li].clone();
    let old = l.get("stops").array().to_vec();
    let looped = eq(first(&stops), last(&stops));
    let uniq = if looped && !stops.is_empty() {
        &stops[..stops.len() - 1]
    } else {
        &stops
    };
    if unique(uniq).len() != uniq.len() || uniq.len() < if looped { 3 } else { 2 } {
        return Err(error("普通线路至少保留两个不同车站，环线至少三个。"));
    }
    if stops.len() > if s.get("region").truth() { 60 } else { 30 } {
        return Err(error("当前地图的单线车站数量已达上限。"));
    }
    let mut ids = vec![];
    for i in 1..stops.len() {
        let a = &stops[i - 1];
        let b = &stops[i];
        let bends = shapes.array().get(i - 1).unwrap_or(&V::Missing);
        let found = s.get("tracks").array().iter().position(|t| {
            corridor(t, a, b)
                && eq(t.get("owner"), l.get("owner"))
                && (!bends.truth()
                    || same_shape(&raw_xy(middle(&G::raw(s, t, a))), &raw_xy(bends.array())))
        });
        let id = if let Some(ti) = found {
            s.get("tracks").array()[ti].get("id").clone()
        } else {
            let mut points = vec![G::node(s, a)];
            points.extend_from_slice(bends.array());
            points.push(G::node(s, b));
            let id = next_id(s, "t");
            let mut t = obj(&[
                ("id", id.clone()),
                ("a", a.clone()),
                ("b", b.clone()),
                ("owner", l.get("owner").clone()),
                ("km", n(G::sum(&points))),
            ]);
            if !bends.array().is_empty() {
                t.set("bends", arr(raw_xy(bends.array())));
            }
            s.get_mut("tracks").array_mut().push(t);
            id
        };
        ids.push(id);
    }
    if l.get("patterns").truth() {
        for p in l.get_mut("patterns").array_mut() {
            let a = at(&arr(old.clone()), p.get("from")).clone();
            let b = at(&arr(old.clone()), p.get("to")).clone();
            let local = p.get("kind").text() == "local";
            let from = if local {
                0.0
            } else {
                pos(&stops, &a).map_or(-1.0, |i| i as f64)
            };
            let to = if local {
                stops.len() as f64 - 1.0
            } else {
                pos(&stops, &b).map_or(-1.0, |i| i as f64)
            };
            p.set("from", n(from));
            p.set("to", n(to));
            if from < 0.0 || to < 0.0 {
                return Err(error("请先调整以该站为端点的交路。"));
            }
            if p.get("calls").truth() {
                let calls = p
                    .get("calls")
                    .array()
                    .iter()
                    .filter(|id| stops.iter().any(|x| same(x, id)))
                    .cloned()
                    .collect();
                p.set("calls", arr(calls));
            }
        }
    }
    for (i, other) in s.get_mut("services").array_mut().iter_mut().enumerate() {
        if i == li || eq(other.get("id"), l.get("id")) || !other.get("patterns").truth() {
            continue;
        }
        for p in other.get_mut("patterns").array_mut() {
            if eq(p.get("target"), l.get("id")) {
                let prev = at(&arr(old.clone()), p.get("targetEnd")).clone();
                let to = pos(&stops, &prev).map_or(-1.0, |i| i as f64);
                p.set("targetEnd", n(to));
                if to < 0.0 {
                    return Err(error("请先调整跨线交路终点。"));
                }
            }
        }
    }
    l.set("stops", arr(stops));
    l.set("trackIds", arr(ids.clone()));
    l.set("through", boolean(false));
    del(&mut l, "parents");
    del(&mut l, "operators");
    s.get_mut("services").array_mut()[li] = l.clone();
    for id in &ids {
        if !s.get("services").array().iter().any(|x| {
            !eq(x.get("id"), l.get("id")) && x.get("trackIds").array().iter().any(|x| same(x, id))
        }) {
            if let Some(i) = index_id(s.get("tracks"), id) {
                del(&mut s.get_mut("tracks").array_mut()[i], "curve");
            }
        }
    }
    G::geometry(s, &l, &shapes)?;
    for (i, id) in ids.iter().enumerate() {
        if load_tph(s, id, &V::Missing)? > 30.0 + 0.0001 {
            let mut t = G::track(s, id).ok_or("线路几何无效。")?.clone();
            let new_id = next_id(s, "t");
            t.set("id", new_id.clone());
            t.set("owner", l.get("owner").clone());
            s.get_mut("tracks").array_mut().push(t);
            s.get_mut("services").array_mut()[li]
                .get_mut("trackIds")
                .array_mut()[i] = new_id;
        }
    }
    prune(s);
    Ok(())
}
pub(super) fn insertion(s: &V, l: &V, p: &V) -> Res<usize> {
    let node = G::node(s, p);
    let mut best = f64::INFINITY;
    let mut index = 1;
    let stops = l.get("stops").array();
    for (j, id) in l.get("trackIds").array().iter().enumerate() {
        let i = j + 1;
        let points = G::points(s, G::track(s, id).ok_or("线路几何无效。")?, &stops[j]);
        let hit = G::closest(&points, &node);
        if hit.0 < best {
            let mut ix = i;
            if !eq(first(stops), last(stops)) {
                if i == 1 && hit.1 == 0 && hit.2 < 0.0 {
                    ix = 0;
                }
                if i == stops.len() - 1 && hit.1 == points.len() - 2 && hit.2 > 1.0 {
                    ix = stops.len();
                }
            }
            best = hit.0;
            index = ix;
        }
    }
    Ok(index)
}
pub(super) fn station_insertion(s: &V, l: &V, p: &V, options: &V) -> Res<V> {
    let object = !integer(p);
    let id = if object {
        n(s.get("nodes").array().len() as f64)
    } else {
        p.clone()
    };
    let mut model = s.clone();
    if object {
        let mut node = p.clone();
        node.set("id", id.clone());
        model.get_mut("nodes").array_mut().push(node);
    }
    let index = if matches!(options.get("index"), V::Missing | V::Null) {
        insertion(&model, l, &id)? as f64
    } else {
        num(options.get("index"))
    };
    let bends = if options.get("bends").truth() {
        options.get("bends").clone()
    } else {
        arr(vec![])
    };
    if !index.is_finite()
        || index.fract() != 0.0
        || index < 0.0
        || index > l.get("stops").array().len() as f64
        || (!matches!(options.get("index"), V::Missing | V::Null) && !integer(options.get("index")))
        || bends.array().len() > 120
        || !matches!(bends, V::Array(_))
        || bends.array().iter().any(|p| {
            !finite(p.get("x"))
                || !finite(p.get("y"))
                || p.num("x") < 25.0
                || p.num("y") < 25.0
                || p.num("x") > s.get("world").num("width") - 25.0
                || p.num("y") > s.get("world").num("height") - 25.0
        })
    {
        return Err(error("固定点或插入位置无效。"));
    }
    let ix = index as usize;
    let mut stops = l.get("stops").array().to_vec();
    let mut shapes = vec![];
    for (i, id) in l.get("trackIds").array().iter().enumerate() {
        shapes.push(arr(middle(&G::raw(
            s,
            G::track(s, id).ok_or("线路几何无效。")?,
            &l.get("stops").array()[i],
        ))
        .to_vec()));
    }
    stops.insert(ix, p.clone());
    let clean = raw_xy(bends.array());
    if ix == 0 {
        let mut p = clean;
        p.reverse();
        shapes.insert(0, arr(p));
    } else if ix == l.get("stops").array().len() {
        shapes.push(arr(clean));
    } else {
        let t = G::track(s, &l.get("trackIds").array()[ix - 1]).ok_or("线路几何无效。")?;
        let p = G::raw(s, t, &l.get("stops").array()[ix - 1]);
        let hit = G::closest(&p, &G::node(&model, &id));
        let mut a = p[1..hit.1 + 1].to_vec();
        a.extend(clean);
        let b = p[hit.1 + 1..p.len() - 1].to_vec();
        shapes.splice(ix - 1..ix, [arr(a), arr(b)]);
    }
    Ok(obj(&[
        ("index", n(index)),
        ("stops", arr(stops)),
        ("shapes", arr(shapes)),
    ]))
}
pub(super) fn fleet_upgrade(s: &mut V, cfg: &V) {
    if s.num("routeModel") != 9.0 {
        return;
    }
    if !s.get("depot").truth() {
        let stock = V::Object(
            cfg.get("specs")
                .entries()
                .iter()
                .map(|(k, _)| (k.clone(), n(0.0)))
                .collect(),
        );
        s.set("depot", obj(&[("version", n(18.0)), ("stock", stock)]));
    }
    let mut migrated = false;
    for i in 0..s.get("services").array().len() {
        if s.get("services").array()[i].get("fleetManaged").truth() {
            continue;
        }
        migrated = true;
        let l = &mut s.get_mut("services").array_mut()[i];
        let cars = if [4.0, 6.0, 8.0].contains(&l.num("cars")) {
            l.num("cars")
        } else {
            6.0
        };
        let spec = format!("{}B", jsstring(&n(cars)));
        let fleet = if l.get("fleet").truth() {
            l.get("fleet").clone()
        } else {
            n(0.0)
        };
        l.set("stockSpec", text(&spec));
        l.set("cars", n(cars));
        l.set("fleetManaged", boolean(true));
        l.set(
            "dispatch",
            obj(&[
                ("mode", text("manual")),
                ("manual", fleet.clone()),
                ("offPeak", fleet.clone()),
                ("peak", fleet.clone()),
            ]),
        );
        let current = s.get("depot").get("stock").zero(&spec);
        s.get_mut("depot")
            .get_mut("stock")
            .set(&spec, n(current + num(&fleet)));
    }
    if migrated {
        let lines = s.get("services").array().to_vec();
        let mut removed = 0;
        for l in s.get_mut("services").array_mut() {
            if !l.get("patterns").truth() {
                continue;
            }
            let spec = l.get("stockSpec").clone();
            l.get_mut("patterns").array_mut().retain(|p| {
                let valid = p.get("kind").text() != "cross"
                    || lines
                        .iter()
                        .find(|x| eq(x.get("id"), p.get("target")))
                        .map_or(matches!(&spec, V::Missing), |x| {
                            eq(x.get("stockSpec"), &spec)
                        });
                if !valid {
                    removed += 1;
                }
                valid
            });
            if l.get("patterns").array().is_empty() {
                del(l, "patterns");
            }
        }
        if removed > 0 {
            s.get_mut("depot").set("migrationNotice",text(&format!("旧跨线交路中有 {removed} 个车型或编组不兼容，已停用这些交路，请在线路详情重新安排。")));
        }
    }
}
pub(super) fn count(v: &V) -> bool {
    integer(v) && v.n() >= 0.0 && v.n() <= 80.0 && v.n() % 2.0 == 0.0
}
pub(super) fn valid_fleet_line(l: &V, cfg: &V) -> bool {
    if !l.get("fleetManaged").truth() {
        return true;
    }
    let spec = cfg.get("specs").get(l.get("stockSpec").text());
    let d = l.get("dispatch");
    let minimum = 2.0 * max(1.0, l.get("patterns").array().len() as f64);
    let mode = d.get("mode").text();
    spec.truth()
        && eq(l.get("cars"), spec.get("cars"))
        && count(l.get("fleet"))
        && d.truth()
        && ["manual", "auto"].contains(&mode)
        && ["manual", "offPeak", "peak"]
            .iter()
            .all(|k| count(d.get(k)))
        && d.num("peak") >= d.num("offPeak")
        && l.num("fleet")
            == if mode == "auto" {
                max(d.num("peak"), d.num("offPeak"))
            } else {
                d.num("manual")
            }
        && [
            if mode == "auto" {
                d.num("offPeak")
            } else {
                d.num("manual")
            },
            if mode == "auto" {
                d.num("peak")
            } else {
                d.num("manual")
            },
        ]
        .iter()
        .all(|x| *x == 0.0 || *x >= minimum)
}
pub(super) fn reserved(s: &V, spec: &V, except: &V) -> f64 {
    s.get("services")
        .array()
        .iter()
        .filter(|l| {
            l.get("fleetManaged").truth()
                && !eq(l.get("id"), except)
                && eq(l.get("stockSpec"), spec)
        })
        .fold(0.0, |a, l| a + num(l.get("fleet")))
}
pub(super) fn valid_fleet(s: &V, cfg: &V) -> bool {
    let depot = s.get("depot");
    if !depot.truth() {
        return s
            .get("services")
            .array()
            .iter()
            .all(|l| !l.get("fleetManaged").truth());
    }
    let stock = depot.get("stock");
    depot.num("version") == 18.0
        && stock.truth()
        && stock.entries().len() == cfg.get("specs").entries().len()
        && cfg.get("specs").entries().iter().all(|(spec, _)| {
            let n = stock.get(spec);
            integer(n)
                && n.n() >= 0.0
                && n.n() <= 2400.0
                && reserved(s, &text(spec), &V::Missing) <= n.n()
        })
        && s.get("services")
            .array()
            .iter()
            .all(|l| valid_fleet_line(l, cfg))
}
fn configure(s: &mut V, id: &V, values: &V, cfg: &V) -> Res<()> {
    let li = index_id(s.get("services"), id).ok_or("线路不存在。")?;
    let mut l = s.get("services").array()[li].clone();
    if l.get("fleetManaged").truth() {
        if (has(values, "cars") && !eq(values.get("cars"), l.get("cars")))
            || (has(values, "stockSpec") && !eq(values.get("stockSpec"), l.get("stockSpec")))
        {
            return Err(error("线路已建成，车型和编组已锁定。"));
        }
        if has(values, "fleet") || has(values, "headway") {
            return Err(error("请通过车库投放设置调整列车数量，间隔自动计算。"));
        }
        let d = values.get("dispatch");
        if d.truth() {
            crate::assets::configure(&mut l, d, cfg)?;
            if s.get("depot").get("stock").zero(l.get("stockSpec").text())
                - reserved(s, l.get("stockSpec"), l.get("id"))
                < l.num("fleet")
            {
                return Err(error(
                    "兼容列车不足，请先到列车库购买或收回其他线路的配属车辆。",
                ));
            }
        }
    }
    for k in COPY_FIELDS {
        if has(values, k) {
            l.set(k, values.get(k).clone());
        }
    }
    if trim(l.get("name").text()).is_empty() || len(l.get("name")) > 40 {
        return Err(error("线路名称须为 1–40 个字符。"));
    }
    s.get_mut("services").array_mut()[li] = l.clone();
    if s.num("routeModel") == 9.0 && !validate_plan(s) {
        return Err(error(
            "交路无效：请检查端点、停站、车队分配、跨线共用站和区间容量（每方向 30 班/小时）。",
        ));
    }
    if load_tph(s, first(l.get("trackIds").array()), &V::Missing)? > 30.0 + 0.0001 {
        return Err(error("当前线路间隔超过轨道容量。"));
    }
    Ok(())
}
pub(super) fn runtime(s: &V, l: &V) -> Res<f64> {
    let mut v = 0.0;
    for id in l.get("trackIds").array() {
        v += G::track(s, id).ok_or("线路几何无效。")?.num("km") / 48.0 * 60.0 + 0.6;
    }
    Ok(v)
}
fn defaults(s: &mut V) -> Res<()> {
    for i in 0..s.get("services").array().len() {
        let mut l = s.get("services").array()[i].clone();
        if !l.get("color").truth() {
            l.set("color", text(COLORS[i % 6]));
        }
        if !l.get("cars").truth() {
            l.set("cars", n(8.0));
        }
        if matches!(l.get("fleet"), V::Missing | V::Null) {
            l.set(
                "fleet",
                n(min(
                    80.0,
                    2.0 * ((runtime(s, &l)? + 1.0) / num(l.get("headway"))).ceil(),
                )),
            );
        }
        if matches!(l.get("open"), V::Missing | V::Null) {
            l.set("open", n(360.0));
        }
        if matches!(l.get("close"), V::Missing | V::Null) {
            l.set("close", n(1440.0));
        }
        s.get_mut("services").array_mut()[i] = l;
    }
    Ok(())
}
fn valid_id(v: &V, prefix: char) -> bool {
    if let V::String(s) = v {
        let mut it = s.chars();
        it.next() == Some(prefix) && s.len() > 1 && it.all(|c| c.is_ascii_digit())
    } else {
        false
    }
}
fn valid_color(v: &V) -> bool {
    if let V::String(s) = v {
        s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
    } else {
        false
    }
}
pub(super) fn validate_world(s: &V, cfg: &V) -> bool {
    validate_world_inner(s, cfg).unwrap_or(false)
}
fn validate_world_inner(s: &V, cfg: &V) -> Res<bool> {
    let region = s.get("region");
    if !matches!(region, V::Missing) && !["tokyo", "gba"].contains(&region.text()) {
        return Ok(false);
    }
    let has_region = region.truth();
    let world = s.get("world");
    if has_region
        && (!world.truth()
            || !eq(
                world.get("width"),
                cfg.get("regions").get(region.text()).get("width"),
            )
            || !eq(
                world.get("height"),
                cfg.get("regions").get(region.text()).get("height"),
            ))
    {
        return Ok(false);
    }
    let nodes = s.get("nodes").array();
    let tracks = s.get("tracks").array();
    let lines = s.get("services").array();
    let companies = s.get("companies").array();
    if !["nodes", "tracks", "services", "companies", "log"]
        .iter()
        .all(|k| matches!(s.get(k), V::Array(_)))
        || s.num("version") != 2.0
        || !integer(s.get("quarter"))
        || s.num("quarter") < 0.0
        || s.num("quarter") > 100000.0
        || nodes.len()
            < if has_region {
                0
            } else {
                cfg.get("seedNodes").array().len()
            }
        || nodes.len() > if has_region { 400 } else { 200 }
        || companies.len() != 3
        || tracks.len() > 600
        || lines.len() > 100
        || !integer(s.get("nextId"))
        || s.num("nextId").abs() > 9007199254740991.0
    {
        return Ok(false);
    }
    let owner = |v: &V| cfg.get("identities").get(v.text()).truth();
    if unique(
        &companies
            .iter()
            .map(|c| c.get("id").clone())
            .collect::<Vec<_>>(),
    )
    .len()
        != 3
        || companies.iter().any(|c| {
            let expected = cfg.get("identities").get(c.get("id").text());
            !owner(c.get("id"))
                || !["name", "short", "color"]
                    .iter()
                    .all(|k| eq(c.get(k), expected.get(k)))
                || !finite(c.get("cash"))
                || !finite(c.get("fare"))
                || c.num("fare") < 100.0
                || c.num("fare") > 500.0
        })
    {
        return Ok(false);
    }
    let width = fallback(world.get("width"), 1040.0);
    let height = fallback(world.get("height"), 740.0);
    for (i, node) in nodes.iter().enumerate() {
        if !eq(node.get("id"), &n(i as f64))
            || !matches!(node.get("name"), V::String(_))
            || len(node.get("name")) > 40
            || !["住宅", "办公", "商业", "工业", "教育", "田园"].contains(&node.get("type").text())
            || !finite(node.get("x"))
            || !finite(node.get("y"))
            || node.num("x") < 20.0
            || node.num("x") > width - 20.0
            || node.num("y") < 20.0
            || node.num("y") > height - 20.0
            || !["people", "jobs", "housing"]
                .iter()
                .all(|k| finite(node.get(k)))
            || node.num("people") < 0.0
            || node.num("jobs") < 0.0
            || node.num("housing") < 1.0
            || ["people", "jobs", "housing"]
                .iter()
                .any(|k| node.num(k) > 1e8)
            || !finite(node.get("growth"))
            || node.num("growth") < 0.0
        {
            return Ok(false);
        }
        if !has_region {
            if let Some(seed) = cfg.get("seedNodes").array().get(i) {
                if !["name", "x", "y", "type"]
                    .iter()
                    .all(|k| eq(node.get(k), seed.get(k)))
                {
                    return Ok(false);
                }
            }
        }
    }
    if unique(
        &tracks
            .iter()
            .map(|t| t.get("id").clone())
            .collect::<Vec<_>>(),
    )
    .len()
        != tracks.len()
    {
        return Ok(false);
    }
    for t in tracks {
        if !valid_id(t.get("id"), 't')
            || !owner(t.get("owner"))
            || matches!(at(s.get("nodes"), t.get("a")), V::Missing)
            || matches!(at(s.get("nodes"), t.get("b")), V::Missing)
            || eq(t.get("a"), t.get("b"))
            || !finite(t.get("km"))
            || (t.num("km") - G::sum(&G::coordinates(s, t, t.get("a")))).abs() > 0.001
        {
            return Ok(false);
        }
    }
    if unique(
        &lines
            .iter()
            .map(|l| l.get("id").clone())
            .collect::<Vec<_>>(),
    )
    .len()
        != lines.len()
    {
        return Ok(false);
    }
    for l in lines {
        let st = l.get("stops").array();
        let tids = l.get("trackIds").array();
        if !valid_id(l.get("id"), 's')
            || !matches!(l.get("name"), V::String(_))
            || len(l.get("name")) > 100
            || !owner(l.get("owner"))
            || !matches!(l.get("stops"), V::Array(_))
            || st.len() < 2
            || st.len() > if has_region { 60 } else { 30 }
            || tids.len() != st.len() - 1
            || !matches!(l.get("headway"),V::Number(h) if [4.0,5.0,6.0,8.0,10.0,12.0,15.0,20.0].contains(h))
        {
            return Ok(false);
        }
        for (i, id) in tids.iter().enumerate() {
            if !G::track(s, id).map_or(false, |t| corridor(t, &st[i], &st[i + 1])) {
                return Ok(false);
            }
        }
    }
    if s.num("routeModel") == 9.0 {
        if !validate_plan(s) {
            return Ok(false);
        }
    } else {
        for t in tracks {
            if load_tph(s, t.get("id"), &V::Missing)? > 30.0 + 0.0001 {
                return Ok(false);
            }
        }
    }
    let mut largest = 0.0_f64;
    for id in tracks.iter().chain(lines).map(|v| v.get("id").text()) {
        largest = largest.max(id.get(1..).unwrap_or("").parse().unwrap_or(f64::NAN));
    }
    if s.num("nextId") <= largest {
        return Ok(false);
    }
    for l in lines {
        let ops = l.get("operators");
        if ops.truth()
            && (!matches!(ops, V::Array(_))
                || ops.array().len() != l.get("trackIds").array().len()
                || ops.array().iter().any(|v| !owner(v)))
        {
            return Ok(false);
        }
        if !matches!(l.get("through"), V::Bool(_)) {
            return Ok(false);
        }
        if l.get("through").truth() {
            let parents = l.get("parents");
            if !matches!(parents, V::Array(_))
                || parents.array().len() != 2
                || parents.array().iter().any(|id| {
                    !lines
                        .iter()
                        .any(|p| eq(p.get("id"), id) && !p.get("through").truth())
                })
            {
                return Ok(false);
            }
        }
    }
    if s.get("log").array().len() > 50
        || s.get("log").array().iter().any(|e| {
            !integer(e.get("q"))
                || e.num("q") < 0.0
                || e.num("q") > s.num("quarter")
                || !matches!(e.get("text"), V::String(_))
                || len(e.get("text")) >= 3000
        })
    {
        return Ok(false);
    }
    if companies.iter().any(|c| {
        !matches!(c.get("ledger"), V::Array(_))
            || c.get("ledger").array().len() > 40
            || (c.get("pendingCapital").truth() && !finite(c.get("pendingCapital")))
            || c.get("ledger").array().iter().any(|row| {
                !["q", "revenue", "cost", "profit", "capital", "cash"]
                    .iter()
                    .all(|k| finite(row.get(k)))
            })
    }) {
        return Ok(false);
    }
    Ok(true)
}
pub(super) fn validate(s: &V, cfg: &V) -> bool {
    validate_world(s, cfg)
        && valid_fleet(s, cfg)
        && s.get("services").array().iter().all(|l| {
            integer(l.get("fleet"))
                && l.num("fleet")
                    >= if l.get("fleetManaged").truth() {
                        0.0
                    } else {
                        2.0
                    }
                && l.num("fleet") <= 80.0
                && l.num("fleet") % 2.0 == 0.0
                && matches!(l.get("cars"),V::Number(x)if [4.0,6.0,8.0].contains(x))
                && integer(l.get("open"))
                && integer(l.get("close"))
                && l.num("open") >= 0.0
                && l.num("close") <= 1440.0
                && l.num("close") - l.num("open") >= 60.0
                && valid_color(l.get("color"))
        })
}
fn merge_nearby(s: &mut V, cfg: &V) -> Res<usize> {
    let mut ids = unique(
        &s.get("services")
            .array()
            .iter()
            .flat_map(|l| l.get("stops").array().iter().cloned())
            .collect::<Vec<_>>(),
    );
    ids.sort_by(|a, b| {
        num(a)
            .partial_cmp(&num(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut count = 0;
    for i in 0..ids.len() {
        for j in i + 1..ids.len() {
            let a = &ids[i];
            let b = &ids[j];
            let na = G::node(s, a);
            let nb = G::node(s, b);
            if !matches!(na.get("mergedInto"), V::Missing)
                || !matches!(nb.get("mergedInto"), V::Missing)
                || G::distance(&na, &nb) > 0.06
                || s.get("services").array().iter().any(|l| {
                    l.get("stops").array().iter().any(|x| same(x, a))
                        && l.get("stops").array().iter().any(|x| same(x, b))
                })
            {
                continue;
            }
            let mut c = s.clone();
            for l in c.get_mut("services").array_mut() {
                for id in l.get_mut("stops").array_mut() {
                    if eq(id, b) {
                        *id = a.clone();
                    }
                }
                if l.get("patterns").truth() {
                    for p in l.get_mut("patterns").array_mut() {
                        if p.get("calls").truth() {
                            let calls = unique(
                                &p.get("calls")
                                    .array()
                                    .iter()
                                    .map(|v| if eq(v, b) { a.clone() } else { v.clone() })
                                    .collect::<Vec<_>>(),
                            );
                            p.set("calls", arr(calls));
                        }
                    }
                }
            }
            c.get_mut("nodes").array_mut()[num(b) as usize].set("mergedInto", a.clone());
            for t in c.get_mut("tracks").array_mut() {
                if eq(t.get("a"), b) {
                    t.set("a", a.clone());
                }
                if eq(t.get("b"), b) {
                    t.set("b", a.clone());
                }
                del(t, "curve");
            }
            let lines = c.get("services").array().to_vec();
            for l in &lines {
                G::geometry(&mut c, l, &V::Missing)?;
            }
            if validate(&c, cfg) {
                *s = c;
                count += 1;
            }
        }
    }
    Ok(count)
}
fn upgrade(s: &mut V, cfg: &V) -> Res<()> {
    s.set("routeModel", n(9.0));
    let lines = s.get("services").array().to_vec();
    for l in &lines {
        G::geometry(s, l, &V::Missing)?;
    }
    let version = s.num("mapVersion");
    if version != 11.0 && version != 12.0 {
        merge_nearby(s, cfg)?;
    }
    if version != 12.0 {
        for i in 0..s.get("tracks").array().len() {
            if s.get("tracks").array()[i].get("curve").truth() {
                s.get_mut("tracks").array_mut()[i]
                    .get_mut("curve")
                    .set("version", n(12.0));
                let t = &s.get("tracks").array()[i];
                let km = G::sum(&G::coordinates(s, t, t.get("a")));
                s.get_mut("tracks").array_mut()[i].set("km", n(km));
            }
        }
        s.set("mapVersion", n(12.0));
    }
    defaults(s)?;
    fleet_upgrade(s, cfg);
    migrate_names(s, cfg)?;
    Ok(())
}
fn migrate_names(s: &mut V, cfg: &V) -> Res<()> {
    for i in 0..s.get("nodes").array().len() {
        let node = s.get("nodes").array()[i].clone();
        let name = node.get("name").text();
        let legacy = name.strip_prefix("新站").map_or(false, |v| {
            let v = v.trim_start_matches(char::is_whitespace);
            !v.is_empty() && v.chars().all(|c| c.is_ascii_digit())
        });
        if node.get("nameSource").text() != "manual" && legacy {
            let naming = named(
                s,
                &node,
                (node.num("id") + 1.0) * 0.173,
                node.get("id"),
                cfg,
            )?;
            let node = &mut s.get_mut("nodes").array_mut()[i];
            node.set("name", naming.get("name").clone());
            node.set("nameSource", naming.get("source").clone());
            node.set("nearbyPlace", naming.get("place").clone());
        }
    }
    Ok(())
}

fn remove_station(s: &mut V, li: usize, id: &V) -> Res<()> {
    let l = s.get("services").array()[li].clone();
    let old = l.get("stops").array();
    if !old.iter().any(|x| same(x, id)) {
        return Err(error("车站不在线路中。"));
    }
    let looped = eq(first(old), last(old));
    let mut stops = old
        .iter()
        .filter(|x| !eq(x, id))
        .cloned()
        .collect::<Vec<_>>();
    if looped && !eq(first(&stops), last(&stops)) {
        stops.push(first(&stops).clone());
    }
    let mut shapes = vec![];
    for i in 1..stops.len() {
        let a = pos(old, &stops[i - 1]).ok_or("线路几何无效。")?;
        let b = pos(old, &stops[i]).ok_or("线路几何无效。")?;
        let end = if looped && b <= a {
            b + old.len() - 1
        } else {
            b
        };
        let mut path = vec![];
        for j in a..end {
            let ix = j % l.get("trackIds").array().len();
            let id = &l.get("trackIds").array()[ix];
            let p = G::raw(s, G::track(s, id).ok_or("线路几何无效。")?, &old[ix]);
            path.extend_from_slice(if path.is_empty() { &p } else { &p[1..] });
        }
        shapes.push(arr(middle(&path).to_vec()));
    }
    route(s, li, stops, arr(shapes))
}
fn add_line(s: &mut V, points: &[V], options: &V, cfg: &V) -> Res<V> {
    if s.get("services").array().len() >= 30 {
        return Err(error("测试地图最多支持 30 条线路。"));
    }
    if points.is_empty()
        || first(points).get("waypoint").truth()
        || last(points).get("waypoint").truth()
    {
        return Err(error("线路必须以车站开始、以车站结束。"));
    }
    let legs = G::draft(s, points)?;
    let mut stops = vec![];
    for p in points {
        if !p.get("waypoint").truth() {
            stops.push(create_node(s, p, cfg)?);
        }
    }
    if legs.len() != stops.len().saturating_sub(1) {
        return Err(error("线路几何无效。"));
    }
    let li = s.get("services").array().len();
    let id = next_id(s, "s");
    let mut l = obj(&[
        ("id", id.clone()),
        ("name", text(&format!("新线路 {:02}", li + 1))),
        (
            "owner",
            s.get("companies")
                .array()
                .get(li % 3)
                .ok_or("线路配置无效，操作未保存。")?
                .get("id")
                .clone(),
        ),
        ("headway", n(8.0)),
        ("through", boolean(false)),
        ("color", text(COLORS[li % 6])),
        ("fleet", n(12.0)),
        ("cars", n(6.0)),
        ("open", n(360.0)),
        ("close", n(1380.0)),
    ]);
    if options.truth() {
        let spec = cfg.get("specs").get(options.get("stockSpec").text());
        if !spec.truth() {
            return Err(error("请选择线路车型。"));
        }
        if !s.get("depot").truth() {
            fleet_upgrade(s, cfg);
        }
        l.set("fleetManaged", boolean(true));
        l.set("stockSpec", options.get("stockSpec").clone());
        l.set("cars", spec.get("cars").clone());
        l.set("fleet", n(0.0));
        l.set(
            "dispatch",
            obj(&[
                ("mode", text("manual")),
                ("manual", n(0.0)),
                ("offPeak", n(0.0)),
                ("peak", n(0.0)),
            ]),
        );
    }
    s.get_mut("services").array_mut().push(l);
    route(
        s,
        li,
        stops,
        arr(legs
            .iter()
            .map(|e| arr(middle(e.get("raw").array()).to_vec()))
            .collect()),
    )?;
    Ok(obj(&[("id", id)]))
}
fn remove_preset(s: &mut V, seed: &V) -> Res<()> {
    let ids = seed
        .get("services")
        .array()
        .iter()
        .map(|l| l.get("id").clone())
        .collect::<Vec<_>>();
    s.get_mut("services")
        .array_mut()
        .retain(|l| !ids.iter().any(|id| same(id, l.get("id"))));
    prune(s);
    let mut keep = unique(
        &s.get("services")
            .array()
            .iter()
            .flat_map(|l| l.get("stops").array().iter().cloned())
            .collect::<Vec<_>>(),
    );
    for node in s.get("nodes").array() {
        if node.num("id") >= seed.get("nodes").array().len() as f64 {
            keep.push(node.get("id").clone());
        }
    }
    let mut mapping = vec![];
    let mut nodes = vec![];
    for node in s.get("nodes").array() {
        if keep.iter().any(|id| same(id, node.get("id"))) {
            mapping.push((node.get("id").clone(), n(nodes.len() as f64)));
            let mut node = node.clone();
            node.set("id", n(nodes.len() as f64));
            nodes.push(node);
        }
    }
    let map = |id: &V| {
        mapping
            .iter()
            .find(|r| same(&r.0, id))
            .map_or(V::Missing, |r| r.1.clone())
    };
    s.set("nodes", arr(nodes));
    for l in s.get_mut("services").array_mut() {
        for id in l.get_mut("stops").array_mut() {
            *id = map(id);
        }
    }
    for t in s.get_mut("tracks").array_mut() {
        t.set("a", map(t.get("a")));
        t.set("b", map(t.get("b")));
    }
    Ok(())
}
pub(super) fn command(s: &mut V, op: &str, args: &V, cfg: &V) -> Res<V> {
    let id = args.get("id");
    match op {
        "restore" => Ok(obj(&[])),
        "addLine" => add_line(s, args.get("points").array(), args.get("options"), cfg),
        "addStation" => {
            let li = index_id(s.get("services"), id).ok_or("请先选择线路。")?;
            let p = create_node(s, args.get("point"), cfg)?;
            let l = s.get("services").array()[li].clone();
            if l.get("stops").array().iter().any(|x| same(x, &p)) {
                return Err(error("该站已经在线路上。"));
            }
            let plan = station_insertion(s, &l, &p, args.get("options"))?;
            route(
                s,
                li,
                plan.get("stops").array().to_vec(),
                plan.get("shapes").clone(),
            )?;
            Ok(obj(&[]))
        }
        "removeStation" => {
            let li = index_id(s.get("services"), id).ok_or("车站不在线路中。")?;
            remove_station(s, li, args.get("nodeId"))?;
            Ok(obj(&[]))
        }
        "removeLine" => {
            if index_id(s.get("services"), id).is_none() {
                return Err(error("线路不存在。"));
            }
            if s.get("services").array().iter().any(|l| {
                l.get("patterns")
                    .array()
                    .iter()
                    .any(|p| eq(p.get("target"), id))
            }) {
                return Err(error("其他线路存在跨线交路，请先移除相关交路。"));
            }
            s.get_mut("services")
                .array_mut()
                .retain(|l| !eq(l.get("id"), id));
            prune(s);
            Ok(obj(&[]))
        }
        "configure" => {
            configure(s, id, args.get("values"), cfg)?;
            Ok(obj(&[]))
        }
        "renameStation" => {
            let node = at(s.get("nodes"), id);
            let name = args.get("name");
            if matches!(node, V::Missing)
                || trim(name.text()).is_empty()
                || trim(name.text()).encode_utf16().count() > 40
            {
                return Err(error("站名须为 1–40 个字符。"));
            }
            let node = &mut s.get_mut("nodes").array_mut()[num(id) as usize];
            node.set("name", text(trim(name.text())));
            node.set("nameSource", text("manual"));
            Ok(obj(&[]))
        }
        "migrateNames" => {
            migrate_names(s, cfg)?;
            Ok(V::Null)
        }
        "defaults" => {
            defaults(s)?;
            Ok(V::Null)
        }
        "upgrade" => {
            upgrade(s, cfg)?;
            Ok(V::Null)
        }
        "mergeNearby" => Ok(n(merge_nearby(s, cfg)? as f64)),
        "removePreset" => {
            remove_preset(s, args.get("seed"))?;
            Ok(V::Null)
        }
        _ => Err(error("未知的线网编辑命令。")),
    }
}
pub(super) fn query(s: &mut V, op: &str, args: &V, cfg: &V) -> Res<V> {
    match op {
        "loadTph" => Ok(n(load_tph(s, args.get("trackId"), args.get("exclude"))?)),
        "suggestName" => named(
            s,
            args.get("point"),
            num(args.get("seed")),
            args.get("except"),
            cfg,
        ),
        "validate" => Ok(boolean(validate(s, cfg))),
        "validateWorld" => Ok(boolean(validate_world(s, cfg))),
        "snap" => Ok(snap(s, args.get("point"))),
        "runtime" => Ok(n(runtime(s, args.get("line"))?)),
        "insertion" => Ok(n(insertion(s, args.get("line"), args.get("point"))? as f64)),
        "stationInsertion" => {
            station_insertion(s, args.get("line"), args.get("point"), args.get("options"))
        }
        "draftLegs" => Ok(arr(G::draft(s, args.get("points").array())?)),
        "linePoints" => Ok(arr(G::line_points(s, args.get("line"))?)),
        "headway" => Ok(n(headway(s, args.get("line"))?)),
        "duration" => Ok(n(duration(s, args.get("line"))?)),
        "loopDwell" => Ok(n(loop_dwell(s, args.get("line"))?)),
        "directions" => Ok(arr(dirs(args.get("line")).into_iter().map(n).collect())),
        "directionName" => {
            let l = args.get("line");
            let mut area = 0.0;
            for pair in l.get("stops").array().windows(2) {
                let a = G::node(s, &pair[0]);
                let b = G::node(s, &pair[1]);
                area += a.num("x") * b.num("y") - b.num("x") * a.num("y");
            }
            Ok(text(
                if if area >= 0.0 {
                    args.num("dir") == 1.0
                } else {
                    args.num("dir") == -1.0
                } {
                    "外环"
                } else {
                    "内环"
                },
            ))
        }
        "geometry" => {
            G::geometry(s, args.get("line"), args.get("shapes"))?;
            Ok(V::Missing)
        }
        "graph" => graph(s),
        _ => Err(error("未知的线网查询。")),
    }
}
fn graph(s: &V) -> Res<V> {
    let op = expanded(s, minute(s))?;
    let mut adj = vec![vec![]; s.get("nodes").array().len()];
    for l in op.get("services").array() {
        let st = l.get("stops").array();
        let mut start = 0;
        for end in 1..st.len() {
            if !l
                .get("callStops")
                .array()
                .iter()
                .any(|id| same(id, &st[end]))
            {
                continue;
            }
            let ids = l.get("trackIds").array()[start..end].to_vec();
            let mut km = 0.0;
            for id in &ids {
                km += G::track(s, id).ok_or("线路几何无效。")?.num("km");
            }
            let mut parts: Vec<V> = vec![];
            for i in start..end {
                let line = l
                    .get("fareLines")
                    .array()
                    .get(i)
                    .cloned()
                    .unwrap_or_default();
                let d = G::track(s, &l.get("trackIds").array()[i])
                    .ok_or("线路几何无效。")?
                    .num("km");
                if let Some(prev) = parts.last_mut().filter(|p| eq(p.get("line"), &line)) {
                    prev.set("km", n(prev.num("km") + d));
                } else {
                    parts.push(obj(&[("line", line), ("km", n(d))]));
                }
            }
            if !l.get("fleet").truth() {
                continue;
            }
            let e = obj(&[
                ("service", l.get("id").clone()),
                ("line", l.get("parentLine").clone()),
                ("owner", l.get("owner").clone()),
                ("km", n(km)),
                ("track", first(&ids).clone()),
                ("tracks", arr(ids.clone())),
                ("parts", arr(parts.clone())),
                ("headway", n(headway(&op, l)?)),
                ("minutes", n(km / 48.0 * 60.0 + loop_dwell(&op, l)?)),
            ]);
            let directions = dirs(l);
            if directions.contains(&1.0) {
                let mut edge = e.clone();
                edge.set("to", st[end].clone());
                edge.set("dir", n(1.0));
                let row = adj
                    .get_mut(num(&st[start]) as usize)
                    .ok_or("线路几何无效。")?;
                row.push(edge);
            }
            if directions.contains(&-1.0) {
                let mut edge = e.clone();
                edge.set("to", st[start].clone());
                edge.set("dir", n(-1.0));
                let mut tracks = ids;
                tracks.reverse();
                let mut reverse = parts;
                reverse.reverse();
                edge.set("tracks", arr(tracks));
                edge.set("parts", arr(reverse));
                adj.get_mut(num(&st[end]) as usize)
                    .ok_or("线路几何无效。")?
                    .push(edge);
            }
            start = end;
        }
    }
    Ok(arr(adj.into_iter().map(arr).collect()))
}
fn run(input: V, cfg: &V) -> V {
    let before = input.get("state");
    let mut s = before.clone();
    let op = input.get("op").text();
    let args = input.get("args");
    let querying = input.get("query").truth();
    let result = if querying {
        query(&mut s, op, args, cfg)
    } else {
        command(&mut s, op, args, cfg)
    };
    match result {
        Err(e) => obj(&[
            ("result", obj(&[("error", text(&e))])),
            ("changed", boolean(false)),
        ]),
        Ok(v) => {
            let validate_commit = !querying
                && !matches!(
                    op,
                    "defaults" | "upgrade" | "mergeNearby" | "removePreset" | "migrateNames"
                );
            if validate_commit && !validate(&s, cfg) {
                return obj(&[
                    (
                        "result",
                        obj(&[("error", text("线路配置无效，操作未保存。"))]),
                    ),
                    ("changed", boolean(false)),
                ]);
            }
            if querying && op != "geometry" {
                return obj(&[("result", v), ("changed", boolean(false))]);
            }
            obj(&[
                ("result", v),
                ("changed", boolean(!querying || op == "geometry")),
                ("patch", crate::editor_delta::project(before, &s)),
            ])
        }
    }
}
#[no_mangle]
pub extern "C" fn editor_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn editor_configured() -> u32 {
    CONFIG.with(|c| c.borrow().is_some() as u32)
}
#[no_mangle]
pub extern "C" fn editor_config() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let mut r = Read { v: &c.input, at: 0 };
        let cfg = value::read(&mut r);
        CONFIG.with(|a| *a.borrow_mut() = Some(cfg));
        c.output = vec![1.0];
        c.output.as_ptr()
    })
}
#[no_mangle]
pub extern "C" fn editor_run() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let mut r = Read { v: &c.input, at: 0 };
        let input = value::read(&mut r);
        let out = CONFIG.with(|cfg| run(input, cfg.borrow().as_ref().expect("editor config")));
        c.output = value::write(&out);
        c.output.as_ptr()
    })
}

pub(super) fn with_config<T>(f: impl FnOnce(&V) -> T) -> T {
    CONFIG.with(|cfg| f(cfg.borrow().as_ref().expect("editor config")))
}
