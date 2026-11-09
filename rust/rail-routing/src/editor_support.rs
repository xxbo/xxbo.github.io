//! Ordered model helpers and reuse of the compact service compiler/validator.
use super::editor_geometry as G;
use crate::value::{object, Value as V};
pub(super) fn obj(v: &[(&'static str, V)]) -> V {
    object(v.iter().cloned())
}
pub(super) fn arr(v: Vec<V>) -> V {
    V::Array(v)
}
pub(super) fn n(v: f64) -> V {
    V::Number(v)
}
pub(super) fn text(v: &str) -> V {
    V::String(v.into())
}
pub(super) fn boolean(v: bool) -> V {
    V::Bool(v)
}
pub(super) fn num(v: &V) -> f64 {
    match v {
        V::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse().unwrap_or(f64::NAN)
            }
        }
        _ => v.n(),
    }
}
pub(super) fn integer(v: &V) -> bool {
    matches!(v,V::Number(x) if x.is_finite()&&x.fract()==0.0)
}
pub(super) fn finite(v: &V) -> bool {
    matches!(v,V::Number(x) if x.is_finite())
}
pub(super) fn eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Number(a), V::Number(b)) => a == b,
        (V::String(a), V::String(b)) => a == b,
        (V::Missing, V::Missing) | (V::Null, V::Null) => true,
        (V::Bool(a), V::Bool(b)) => a == b,
        _ => false,
    }
}
pub(super) fn same(a: &V, b: &V) -> bool {
    eq(a, b) || matches!((a,b),(V::Number(a),V::Number(b))if a.is_nan()&&b.is_nan())
}
pub(super) fn has(v: &V, k: &str) -> bool {
    v.entries().iter().any(|r| r.0 == k)
}
pub(super) fn del(v: &mut V, k: &str) {
    if let V::Object(a) = v {
        a.retain(|r| r.0 != k);
    }
}
pub(super) fn first(v: &[V]) -> &V {
    v.first().unwrap_or(&V::Missing)
}
pub(super) fn last(v: &[V]) -> &V {
    v.last().unwrap_or(&V::Missing)
}
pub(super) fn middle(v: &[V]) -> &[V] {
    if v.len() > 1 {
        &v[1..v.len() - 1]
    } else {
        &[]
    }
}
pub(super) fn at<'a>(v: &'a V, id: &V) -> &'a V {
    let x = num(id);
    if x.is_finite() && x >= 0.0 && x.fract() == 0.0 {
        v.array().get(x as usize).unwrap_or(&V::Missing)
    } else {
        &V::Missing
    }
}
pub(super) fn index_id(v: &V, id: &V) -> Option<usize> {
    v.array().iter().position(|r| eq(r.get("id"), id))
}
pub(super) fn pos(v: &[V], x: &V) -> Option<usize> {
    v.iter().position(|v| eq(v, x))
}
pub(super) fn unique(v: &[V]) -> Vec<V> {
    let mut out = vec![];
    for x in v {
        if !out.iter().any(|v| same(v, x)) {
            out.push(x.clone());
        }
    }
    out
}
pub(super) fn min(a: f64, b: f64) -> f64 {
    crate::demand::min(a, b)
}
pub(super) fn max(a: f64, b: f64) -> f64 {
    crate::demand::max(a, b)
}
pub(super) fn fallback(v: &V, default: f64) -> f64 {
    if v.truth() {
        num(v)
    } else {
        default
    }
}
pub(super) fn len(v: &V) -> usize {
    match v {
        V::Array(a) => a.len(),
        V::String(s) => s.encode_utf16().count(),
        _ => 0,
    }
}
pub(super) fn trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}
pub(super) fn jsstring(v: &V) -> String {
    match v {
        V::String(s) => s.clone(),
        V::Number(x) => {
            if x.fract() == 0.0 {
                format!("{x:.0}")
            } else {
                x.to_string()
            }
        }
        V::Null => "null".into(),
        V::Missing => "undefined".into(),
        V::Bool(v) => v.to_string(),
        _ => "[object Object]".into(),
    }
}
pub(super) const KINDS: [&str; 5] = ["local", "short", "express", "direct", "cross"];
const LABELS: [&str; 5] = ["普通·大交路", "区间·小交路", "快速", "直达", "跨线"];
fn intern(ids: &mut Vec<V>, v: &V) -> usize {
    if let Some(i) = ids.iter().position(|x| same(x, v)) {
        i
    } else {
        ids.push(v.clone());
        ids.len() - 1
    }
}
pub(super) fn pattern_values(p: &V, services: &[V], strict: bool) -> Vec<f64> {
    let scalar = |v: &V| {
        if strict && !matches!(v, V::Number(_)) {
            f64::NAN
        } else {
            num(v)
        }
    };
    let kind = KINDS
        .iter()
        .position(|k| *k == p.get("kind").text())
        .map_or(-1.0, |i| i as f64);
    let target = if kind == 4.0 {
        services
            .iter()
            .position(|l| eq(l.get("id"), p.get("target")))
            .map_or(-1.0, |i| i as f64)
    } else {
        -1.0
    };
    let calls = p.get("calls").array();
    let mut v = vec![
        kind,
        scalar(p.get("from")),
        scalar(p.get("to")),
        scalar(p.get("fleet")),
        target,
        scalar(p.get("targetEnd")),
        calls.len() as f64,
    ];
    v.extend(calls.iter().map(scalar));
    v
}
pub(super) fn service_frame(s: &V, minute: f64, strict: bool) -> (Vec<f64>, Vec<V>) {
    let services = s.get("services").array();
    let mut keys = vec![];
    let mut specs = vec![];
    let mut tracks = vec![];
    let mut v = vec![1.0, 0.0, minute, 0.0, 0.0, services.len() as f64];
    for l in services {
        let d = l.get("dispatch");
        v.extend([
            intern(&mut keys, l.get("id")) as f64,
            intern(&mut specs, l.get("stockSpec")) as f64,
            l.get("fleetManaged").truth() as u8 as f64,
            (d.get("mode").text() == "auto") as u8 as f64,
            num(d.get("manual")),
            num(d.get("offPeak")),
            num(d.get("peak")),
            num(l.get("fleet")),
            l.get("stops").array().len() as f64,
        ]);
        v.extend(l.get("stops").array().iter().map(num));
        v.push(l.get("trackIds").array().len() as f64);
        for id in l.get("trackIds").array() {
            v.push(intern(&mut tracks, id) as f64);
        }
        v.push(l.get("patterns").truth() as u8 as f64);
        v.push(l.get("patterns").array().len() as f64);
        for p in l.get("patterns").array() {
            v.extend(pattern_values(p, services, strict));
        }
    }
    (v, tracks)
}
pub(super) fn validate_plan(s: &V) -> bool {
    if s.get("services")
        .array()
        .iter()
        .any(|l| l.get("patterns").truth() && !matches!(l.get("patterns"), V::Array(_)))
    {
        return false;
    }
    let (frame, tracks) = service_frame(s, minute(s), true);
    let mut v = vec![1.0, frame.len() as f64];
    v.extend(frame);
    v.extend([
        (s.num("routeModel") == 9.0 && !s.get("operatingPlan").truth()) as u8 as f64,
        s.get("world").truth() as u8 as f64,
        num(s.get("world").get("width")),
        num(s.get("world").get("height")),
        tracks.len() as f64,
        s.get("tracks").array().len() as f64,
    ]);
    for t in s.get("tracks").array() {
        v.extend([
            tracks
                .iter()
                .position(|x| same(x, t.get("id")))
                .map_or(-1.0, |i| i as f64),
            num(t.get("km")),
        ]);
        for k in ["before", "after"] {
            let p = t.get("curve").get(k);
            v.push(p.truth() as u8 as f64);
            if p.truth() {
                v.extend([
                    if finite(p.get("x")) {
                        p.num("x")
                    } else {
                        f64::NAN
                    },
                    if finite(p.get("y")) {
                        p.num("y")
                    } else {
                        f64::NAN
                    },
                ]);
            }
        }
        let bends = t.get("bends");
        v.push(if !bends.truth() {
            0.0
        } else if matches!(bends, V::Array(_)) {
            1.0
        } else {
            -1.0
        });
        v.extend([bends.array().len() as f64, bends.array().len() as f64]);
        for p in bends.array() {
            if matches!(p, V::Missing | V::Null) {
                return false;
            }
            v.extend([
                if finite(p.get("x")) {
                    p.num("x")
                } else {
                    f64::NAN
                },
                if finite(p.get("y")) {
                    p.num("y")
                } else {
                    f64::NAN
                },
            ]);
        }
    }
    for l in s.get("services").array() {
        let bands = l.get("fareBands");
        v.push(if !bands.truth() {
            0.0
        } else if matches!(bands, V::Array(_)) {
            1.0
        } else {
            -1.0
        });
        v.push(bands.array().len() as f64);
        for x in bands.array() {
            v.extend([
                1.0,
                if matches!(x, V::Number(_)) {
                    x.n()
                } else {
                    f64::NAN
                },
            ]);
        }
        let dir = l.get("loopDirection");
        v.push(if !dir.truth() {
            0.0
        } else {
            ["both", "forward", "reverse"]
                .iter()
                .position(|x| *x == dir.text())
                .map_or(-1.0, |i| (i + 1) as f64)
        });
        v.extend([
            num(l.get("headway")),
            if l.get("callStops").truth() {
                len(l.get("callStops")) as f64
            } else {
                l.get("stops").array().len() as f64
            },
            l.get("dispatchCompiled").truth() as u8 as f64,
        ]);
        if l.get("patterns").truth() {
            for p in l.get("patterns").array() {
                v.extend([
                    if matches!(p.get("headway"), V::Number(_)) {
                        p.num("headway")
                    } else {
                        f64::NAN
                    },
                    matches!(p.get("calls"), V::Array(_)) as u8 as f64,
                ]);
            }
        } else {
            v.extend([num(l.get("headway")), 0.0]);
        }
    }
    crate::service_validation::valid(&v)
}
pub(super) fn minute(s: &V) -> f64 {
    if matches!(s.get("economy").get("minute"), V::Missing | V::Null) {
        420.0
    } else {
        num(s.get("economy").get("minute"))
    }
}
fn operation_view(s: &V, lines: V) -> V {
    obj(&[
        ("services", lines),
        (
            "tracks",
            arr(s
                .get("tracks")
                .array()
                .iter()
                .map(|t| obj(&[("id", t.get("id").clone()), ("km", t.get("km").clone())]))
                .collect()),
        ),
        ("economy", s.get("economy").clone()),
        ("routeModel", s.get("routeModel").clone()),
    ])
}
pub(super) fn expanded(s: &V, minute: f64) -> Result<V, String> {
    if s.num("routeModel") != 9.0 || s.get("operatingPlan").truth() {
        return Ok(operation_view(s, s.get("services").clone()));
    }
    let (frame, tracks) = service_frame(s, minute, false);
    let data = crate::services::run(&frame);
    if data[1] != 0.0 {
        return Err(compile_error(data[1] as usize).into());
    }
    let mut at = 3;
    let mut lines = vec![];
    for _ in 0..data[2] as usize {
        let end = at + 1 + data[at] as usize;
        at += 1;
        let src = data[at] as usize;
        let ordinal = data[at + 1] as usize;
        let default = data[at + 2] != 0.0;
        let mode = data[at + 3] as usize;
        let allocated = data[at + 4];
        at += 5;
        let base = &s.get("services").array()[src];
        let mut l = base.clone();
        let p = if default {
            V::Missing
        } else {
            base.get("patterns").array()[ordinal].clone()
        };
        let kind = if default {
            "local"
        } else {
            p.get("kind").text()
        };
        let kind_ix = KINDS.iter().position(|x| *x == kind);
        let ns = data[at] as usize;
        at += 1;
        let stops = data[at..at + ns].iter().map(|x| n(*x)).collect::<Vec<_>>();
        at += ns;
        let nt = data[at] as usize;
        at += 1;
        let tids = data[at..at + nt]
            .iter()
            .map(|x| tracks[*x as usize].clone())
            .collect();
        at += nt;
        let fares = data[at..at + nt]
            .iter()
            .map(|x| s.get("services").array()[*x as usize].get("id").clone())
            .collect();
        at += nt;
        let nc = data[at] as usize;
        at += 1;
        let calls = data[at..at + nc].iter().map(|x| n(*x)).collect();
        at += nc;
        assert_eq!(at, end);
        l.set(
            "id",
            if ordinal == 0 {
                base.get("id").clone()
            } else {
                text(&format!("{}p{}", jsstring(base.get("id")), ordinal))
            },
        );
        l.set("parentLine", base.get("id").clone());
        l.set("patternIndex", n(ordinal as f64));
        l.set("patternKind", text(kind));
        l.set(
            "name",
            text(&format!(
                "{} · {}",
                jsstring(base.get("name")),
                kind_ix.map_or("undefined", |i| LABELS[i])
            )),
        );
        l.set("stops", arr(stops));
        l.set("trackIds", arr(tids));
        l.set("fareLines", arr(fares));
        l.set("callStops", arr(calls));
        l.set(
            "fleet",
            match mode {
                0 => base.get("fleet").clone(),
                1 => p.get("fleet").clone(),
                2 => n(allocated),
                _ => V::Missing,
            },
        );
        l.set(
            "dispatchCompiled",
            boolean(base.get("fleetManaged").truth()),
        );
        l.set(
            "headway",
            if default {
                base.get("headway").clone()
            } else {
                p.get("headway").clone()
            },
        );
        l.set("through", boolean(false));
        l.set("operators", V::Missing);
        l.set("parents", V::Missing);
        lines.push(l);
    }
    let mut out = operation_view(s, arr(lines));
    out.set("operatingPlan", boolean(true));

    Ok(out)
}
pub(super) fn compile_error(i: usize) -> &'static str {
    match i {
        1 => "跨线目标不存在。",
        2 => "两条线路必须在同一座车站连接。",
        3 => "跨线目标不能是本线路。",
        4 => "跨线交路需要相同车型与编组。",
        5 => "交路不能重复经过同一车站。",
        6 => "直达交路的起终点必须不同。",
        _ => "交路配置无效。",
    }
}
pub(super) fn dirs(l: &V) -> Vec<f64> {
    let st = l.get("stops").array();
    if eq(first(st), last(st)) {
        match l.get("loopDirection").text() {
            "forward" => return vec![1.0],
            "reverse" => return vec![-1.0],
            _ => (),
        }
    }
    vec![1.0, -1.0]
}
pub(super) fn duration(s: &V, l: &V) -> Result<f64, String> {
    let mut d = 0.0;
    for id in l.get("trackIds").array() {
        d += G::track(s, id).ok_or("线路几何无效。")?.num("km") / 48.0 * 60.0;
    }
    d += ((if l.get("callStops").truth() {
        len(l.get("callStops"))
    } else {
        l.get("stops").array().len()
    }) as f64
        - 1.0)
        * 0.6;
    Ok(d)
}
pub(super) fn planned(l: &V, minute: f64) -> f64 {
    if !l.get("fleetManaged").truth() {
        return num(l.get("fleet"));
    }
    let d = l.get("dispatch");
    if d.get("mode").text() == "auto" {
        if crate::temporal::peak(minute) {
            num(d.get("peak"))
        } else {
            num(d.get("offPeak"))
        }
    } else {
        num(d.get("manual"))
    }
}
pub(super) fn headway(s: &V, l: &V) -> Result<f64, String> {
    let managed = l.get("fleetManaged").truth();
    let fleet = if managed && !l.get("dispatchCompiled").truth() {
        planned(l, minute(s))
    } else {
        num(l.get("fleet"))
    };
    if managed && (fleet == 0.0 || fleet.is_nan()) {
        return Ok(f64::INFINITY);
    }
    let d = duration(s, l)?;
    let st = l.get("stops").array();
    let looped = eq(first(st), last(st));
    let cycle = if looped {
        d * dirs(l).len() as f64
    } else {
        2.0 * (d + 1.0)
    };
    Ok(max(
        if managed { 2.0 } else { num(l.get("headway")) },
        if looped && !managed {
            d / (fleet / dirs(l).len() as f64)
        } else {
            cycle / fleet
        },
    ))
}
pub(super) fn loop_dwell(s: &V, l: &V) -> Result<f64, String> {
    let st = l.get("stops").array();
    if !eq(first(st), last(st)) {
        return Ok(0.6);
    }
    let cycle = duration(s, l)?;
    let h = headway(s, l)?;
    let count = max(1.0, (cycle / h - 1e-8).ceil());
    let calls = unique(if l.get("callStops").truth() {
        l.get("callStops").array()
    } else {
        st
    })
    .len();
    Ok(0.6 + max(0.0, count * h - cycle) / max(1.0, calls as f64))
}
pub(super) fn load_tph(s: &V, id: &V, exclude: &V) -> Result<f64, String> {
    let modern = s.num("routeModel") == 9.0;
    let op = if modern {
        expanded(s, 480.0)?
    } else {
        operation_view(s, s.get("services").clone())
    };
    let mut out = 0.0;
    for l in op.get("services").array() {
        if eq(l.get(if modern { "parentLine" } else { "id" }), exclude) {
            continue;
        }
        if !l.get("trackIds").array().iter().any(|x| same(x, id)) {
            continue;
        }
        let h = if modern {
            headway(&op, l)?
        } else if !l.get("fleet").truth() {
            num(l.get("headway"))
        } else {
            let mut cycle = 0.0;
            for id in l.get("trackIds").array() {
                cycle += G::track(&op, id).ok_or("线路几何无效。")?.num("km") / 48.0 * 60.0 + 0.6;
            }
            max(
                num(l.get("headway")),
                2.0 * (cycle + 1.0) / num(l.get("fleet")),
            )
        };
        out += 60.0 / h;
    }
    Ok(out)
}
