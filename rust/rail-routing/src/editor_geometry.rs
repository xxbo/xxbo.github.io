//! Geometry shared by editing, validation, previews and the renderer's numeric adapter.
use super::editor_support::*;
use crate::{queues::Read, value::Value as V, CORE};
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "rail_math")]
extern "C" {
    #[link_name = "acos"]
    fn host_acos(x: f64) -> f64;
    #[link_name = "atan2"]
    fn host_atan2(y: f64, x: f64) -> f64;
}
fn acos(x: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return host_acos(x);
    }
    #[cfg(not(target_arch = "wasm32"))]
    x.acos()
}
fn atan2(y: f64, x: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        return host_atan2(y, x);
    }
    #[cfg(not(target_arch = "wasm32"))]
    y.atan2(x)
}
pub(super) fn xy(p: &V) -> V {
    if p.truth() {
        obj(&[("x", p.get("x").clone()), ("y", p.get("y").clone())])
    } else {
        V::Null
    }
}
pub(super) fn point(x: f64, y: f64) -> V {
    obj(&[("x", n(x)), ("y", n(y))])
}
pub(super) fn length(a: &V, b: &V) -> f64 {
    crate::demand::hypot(b.num("x") - a.num("x"), b.num("y") - a.num("y"))
}
pub(super) fn distance(a: &V, b: &V) -> f64 {
    length(a, b) * 0.045
}
pub(super) fn sum(p: &[V]) -> f64 {
    p.windows(2).fold(0.0, |a, b| a + distance(&b[0], &b[1]))
}
pub(super) fn smooth(p: &[V], before: &V, after: &V, version: f64) -> Vec<V> {
    let mut out = vec![p.first().cloned().unwrap_or_default()];
    let handles = p
        .iter()
        .enumerate()
        .map(|(i, b)| {
            let a = if i > 0 { &p[i - 1] } else { before };
            let c = if i + 1 < p.len() { &p[i + 1] } else { after };
            if !a.truth() || !c.truth() {
                return None;
            }
            let d1 = length(a, b);
            let d2 = length(b, c);
            if d1 < 1e-6 || d2 < 1e-6 {
                return None;
            }
            let ux = (b.num("x") - a.num("x")) / d1;
            let uy = (b.num("y") - a.num("y")) / d1;
            let vx = (c.num("x") - b.num("x")) / d2;
            let vy = (c.num("y") - b.num("y")) / d2;
            let angle =
                acos(max(-1.0, min(1.0, -ux * vx - uy * vy))) * 180.0 / std::f64::consts::PI;
            if angle
                > if version == 12.0 {
                    170.00001
                } else {
                    120.00001
                }
            {
                return None;
            }
            let mut x = ux + vx;
            let mut y = uy + vy;
            let mut size = crate::demand::hypot(x, y);
            if size < 1e-6 {
                x = -uy;
                y = ux;
                size = 1.0;
            }
            Some((
                x / size,
                y / size,
                if version == 12.0 {
                    min(min(d1 * 0.46, d2 * 0.46), 42.0)
                } else {
                    min(min(d1 * 0.22, d2 * 0.22), 12.0)
                },
            ))
        })
        .collect::<Vec<_>>();
    for i in 1..p.len() {
        let a = &p[i - 1];
        let b = &p[i];
        let h = handles[i - 1];
        let j = handles[i];
        if h.is_none() && j.is_none() {
            out.push(b.clone());
            continue;
        }
        let d = length(a, b);
        let ratio = if version == 12.0 { 0.46 } else { 0.3 };
        let (ux, uy) = if let Some((x, y, l)) = h {
            (
                a.num("x") + x * min(l, d * ratio),
                a.num("y") + y * min(l, d * ratio),
            )
        } else {
            (
                a.num("x") + (b.num("x") - a.num("x")) / 3.0,
                a.num("y") + (b.num("y") - a.num("y")) / 3.0,
            )
        };
        let (vx, vy) = if let Some((x, y, l)) = j {
            (
                b.num("x") - x * min(l, d * ratio),
                b.num("y") - y * min(l, d * ratio),
            )
        } else {
            (
                b.num("x") - (b.num("x") - a.num("x")) / 3.0,
                b.num("y") - (b.num("y") - a.num("y")) / 3.0,
            )
        };
        for k in 1..=16 {
            let z = k as f64 / 16.0;
            let q = 1.0 - z;
            out.push(point(
                q * q * q * a.num("x")
                    + 3.0 * q * q * z * ux
                    + 3.0 * q * z * z * vx
                    + z * z * z * b.num("x"),
                q * q * q * a.num("y")
                    + 3.0 * q * q * z * uy
                    + 3.0 * q * z * z * vy
                    + z * z * z * b.num("y"),
            ));
        }
    }
    out
}
pub(super) fn node(s: &V, id: &V) -> V {
    at(s.get("nodes"), id).clone()
}
pub(super) fn track<'a>(s: &'a V, id: &V) -> Option<&'a V> {
    s.get("tracks").array().iter().find(|t| eq(t.get("id"), id))
}
pub(super) fn raw(s: &V, t: &V, from: &V) -> Vec<V> {
    let mut out = vec![node(s, t.get("a"))];
    out.extend(t.get("bends").array().iter().cloned());
    out.push(node(s, t.get("b")));
    if !eq(from, t.get("a")) {
        out.reverse();
    }
    out
}
pub(super) fn points(s: &V, t: &V, from: &V) -> Vec<V> {
    let mut p = raw(s, t, t.get("a"));
    let c = t.get("curve");
    if c.truth() {
        p = smooth(
            &p,
            c.get("before"),
            c.get("after"),
            if c.get("version").truth() {
                c.num("version")
            } else {
                11.0
            },
        );
    }
    if !eq(from, t.get("a")) {
        p.reverse();
    }
    p
}
// Numeric geometry never clones names, population or other node view metadata.
pub(super) fn coordinates(s: &V, t: &V, from: &V) -> Vec<V> {
    let mut p = vec![xy(at(s.get("nodes"), t.get("a")))];
    p.extend(t.get("bends").array().iter().map(xy));
    p.push(xy(at(s.get("nodes"), t.get("b"))));
    let c = t.get("curve");
    if c.truth() {
        p = smooth(
            &p,
            c.get("before"),
            c.get("after"),
            if c.get("version").truth() {
                c.num("version")
            } else {
                11.0
            },
        );
    }
    if !eq(from, t.get("a")) {
        p.reverse();
    }
    p
}
pub(super) fn geometry(s: &mut V, l: &V, shapes: &V) -> Result<(), String> {
    let ids = l.get("trackIds").array();
    let stops = l.get("stops").array();
    let looped = eq(first(stops), last(stops));
    let count = ids.len();
    for i in 0..count {
        let ti = index_id(s.get("tracks"), &ids[i]).ok_or("线路几何无效。")?;
        if s.get("tracks").array()[ti].get("curve").truth() {
            continue;
        }
        let prev = if i > 0 {
            Some(i - 1)
        } else if looped && count > 0 {
            Some(count - 1)
        } else {
            None
        };
        let next = if i + 1 < count {
            Some(i + 1)
        } else if looped {
            Some(0)
        } else {
            None
        };
        let raw_at = |ix: usize| -> Result<Vec<V>, String> {
            let mut p = vec![node(s, &stops[ix])];
            let shape = shapes.array().get(ix).unwrap_or(&V::Missing);
            if shape.truth() {
                p.extend_from_slice(shape.array());
            } else {
                let t = track(s, &ids[ix]).ok_or("线路几何无效。")?;
                let r = raw(s, t, &stops[ix]);
                p.extend_from_slice(middle(&r));
            }
            p.push(node(s, &stops[ix + 1]));
            Ok(p)
        };
        let before = if let Some(ix) = prev {
            let p = raw_at(ix)?;
            p.get(p.len().saturating_sub(2))
                .cloned()
                .unwrap_or_default()
        } else {
            V::Null
        };
        let after = if let Some(ix) = next {
            raw_at(ix)?.get(1).cloned().unwrap_or_default()
        } else {
            V::Null
        };
        let forward = eq(s.get("tracks").array()[ti].get("a"), &stops[i]);
        let curve = obj(&[
            ("before", xy(if forward { &before } else { &after })),
            ("after", xy(if forward { &after } else { &before })),
            ("version", n(12.0)),
        ]);
        s.get_mut("tracks").array_mut()[ti].set("curve", curve);
        let t = &s.get("tracks").array()[ti];
        let km = sum(&coordinates(s, t, t.get("a")));
        s.get_mut("tracks").array_mut()[ti].set("km", n(km));
    }
    Ok(())
}
pub(super) fn line_points(s: &V, l: &V) -> Result<Vec<V>, String> {
    let mut out = vec![];
    for (i, id) in l.get("trackIds").array().iter().enumerate() {
        let t = track(s, id).ok_or("线路几何无效。")?;
        let p = points(s, t, &l.get("stops").array()[i]);
        out.extend_from_slice(if i == 0 { &p } else { &p[1..] });
    }
    Ok(out)
}
pub(super) fn closest(points: &[V], p: &V) -> (f64, usize, f64) {
    let mut best = (f64::INFINITY, 0, 0.0);
    for (i, pair) in points.windows(2).enumerate() {
        let a = &pair[0];
        let b = &pair[1];
        let dx = b.num("x") - a.num("x");
        let dy = b.num("y") - a.num("y");
        let d = dx * dx + dy * dy;
        let u = if d != 0.0 {
            ((p.num("x") - a.num("x")) * dx + (p.num("y") - a.num("y")) * dy) / d
        } else {
            0.0
        };
        let v = max(0.0, min(1.0, u));
        let dist = crate::demand::hypot(
            p.num("x") - a.num("x") - dx * v,
            p.num("y") - a.num("y") - dy * v,
        );
        if dist < best.0 {
            best = (dist, i, u);
        }
    }
    best
}
pub(super) fn along(points: &[V], progress: f64) -> V {
    let target = sum(points) * max(0.0, min(1.0, progress));
    let mut km = 0.0;
    for i in 1..points.len() {
        let a = &points[i - 1];
        let b = &points[i];
        let d = distance(a, b);
        if km + d >= target || i == points.len() - 1 {
            let f = if d != 0.0 {
                max(0.0, min(1.0, (target - km) / d))
            } else {
                0.0
            };
            return obj(&[
                ("x", n(a.num("x") + (b.num("x") - a.num("x")) * f)),
                ("y", n(a.num("y") + (b.num("y") - a.num("y")) * f)),
                (
                    "angle",
                    n(
                        atan2(b.num("y") - a.num("y"), b.num("x") - a.num("x")) * 180.0
                            / std::f64::consts::PI,
                    ),
                ),
            ]);
        }
        km += d;
    }
    let mut v = points.first().cloned().unwrap_or_else(|| obj(&[]));
    v.set("angle", n(0.0));
    v
}
pub(super) fn draft(s: &V, input: &[V]) -> Result<Vec<V>, String> {
    let mut rows = vec![];
    let mut from = V::Null;
    let mut bends = vec![];
    for item in input {
        let p = if integer(item) {
            node(s, item)
        } else {
            item.clone()
        };
        if matches!(p, V::Missing | V::Null) {
            return Err("线路几何无效。".into());
        }
        if p.get("waypoint").truth() {
            if from.truth() {
                bends.push(p);
            }
            continue;
        }
        if from.truth() {
            let mut raw = vec![from.clone()];
            raw.extend(bends.clone());
            raw.push(p.clone());
            rows.push(obj(&[
                ("from", from.clone()),
                ("to", p.clone()),
                ("raw", arr(raw)),
            ]));
        }
        from = p;
        bends.clear();
    }
    let looped =
        rows.len() > 2 && distance(rows[0].get("from"), rows.last().unwrap().get("to")) < 1e-6;
    for i in 0..rows.len() {
        let prev = if i > 0 {
            Some(i - 1)
        } else if looped {
            Some(rows.len() - 1)
        } else {
            None
        };
        let next = if i + 1 < rows.len() {
            Some(i + 1)
        } else if looped {
            Some(0)
        } else {
            None
        };
        let before = prev
            .map(|j| {
                let p = rows[j].get("raw").array();
                p[p.len() - 2].clone()
            })
            .unwrap_or_default();
        let after = next
            .map(|j| rows[j].get("raw").array()[1].clone())
            .unwrap_or_default();
        let path = smooth(rows[i].get("raw").array(), &before, &after, 12.0);
        rows[i].set("km", n(sum(&path)));
        rows[i].set("points", arr(path)); // projection orders points before km below
        let km = rows[i].get("km").clone();
        del(&mut rows[i], "km");
        rows[i].set("km", km);
    }
    Ok(rows)
}
#[no_mangle]
pub extern "C" fn geometry_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn geometry_run() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        let mut r = Read { v: &c.input, at: 0 };
        assert_eq!(r.f(), 1.0);
        let op = r.u();
        let mut out = vec![1.0];
        match op {
            0 => {
                let version = r.f();
                let before = if r.f() != 0.0 {
                    point(r.f(), r.f())
                } else {
                    let _ = (r.f(), r.f());
                    V::Null
                };
                let after = if r.f() != 0.0 {
                    point(r.f(), r.f())
                } else {
                    let _ = (r.f(), r.f());
                    V::Null
                };
                let count = r.u();
                let input = (0..count)
                    .map(|i| {
                        let mut p = point(r.f(), r.f());
                        p.set("$ref", n(i as f64));
                        p
                    })
                    .collect::<Vec<_>>();
                let p = smooth(&input, &before, &after, version);
                out.push(p.len() as f64);
                for q in p {
                    let id = if count == 0 {
                        0.0
                    } else {
                        if matches!(q.get("$ref"), V::Missing) {
                            -1.0
                        } else {
                            q.num("$ref")
                        }
                    };
                    out.extend([id, q.num("x"), q.num("y")]);
                }
            }
            1 => {
                let count = r.u();
                let p = (0..count).map(|_| point(r.f(), r.f())).collect::<Vec<_>>();
                out.push(sum(&p));
            }
            2 => {
                let a = point(r.f(), r.f());
                let b = point(r.f(), r.f());
                out.push(distance(&a, &b));
            }
            3 => {
                let progress = r.f();
                let count = r.u();
                let p = (0..count).map(|_| point(r.f(), r.f())).collect::<Vec<_>>();
                let v = along(&p, progress);
                out.extend([
                    v.num("x"),
                    v.num("y"),
                    v.num("angle"),
                    if p.len() < 2 { 0.0 } else { -1.0 },
                ]);
            }
            4 => {
                let managed = r.f() != 0.0;
                let compiled = r.f() != 0.0;
                let auto = r.f() != 0.0;
                let minute = r.f();
                let manual = r.f();
                let off = r.f();
                let peak = r.f();
                let raw_fleet = r.f();
                let base = r.f();
                let looped = r.f() != 0.0;
                let direction = r.u();
                let stops = r.f();
                let custom = r.f() != 0.0;
                let calls = r.f();
                let count = r.u();
                let mut duration = 0.0;
                let mut missing = false;
                for _ in 0..count {
                    missing |= r.f() == 0.0;
                    duration += r.f() / 48.0 * 60.0;
                }
                let calls = if custom { calls } else { stops };
                duration += (calls - 1.0) * 0.6;
                let fleet = if managed && !compiled {
                    if auto {
                        if crate::temporal::peak(minute) {
                            peak
                        } else {
                            off
                        }
                    } else {
                        manual
                    }
                } else {
                    raw_fleet
                };
                let dirs = if looped && (direction == 2 || direction == 3) {
                    1.0
                } else {
                    2.0
                };
                let headway = if managed && (fleet == 0.0 || fleet.is_nan()) {
                    f64::INFINITY
                } else {
                    max(
                        if managed { 2.0 } else { base },
                        if looped {
                            if managed {
                                duration * dirs / fleet
                            } else {
                                duration / (fleet / dirs)
                            }
                        } else {
                            2.0 * (duration + 1.0) / fleet
                        },
                    )
                };
                let unique_calls = r.f();
                let dwell = if looped {
                    let n = max(1.0, (duration / headway - 1e-8).ceil());
                    0.6 + max(0.0, n * headway - duration) / max(1.0, unique_calls)
                } else {
                    0.6
                };
                out.extend([
                    duration,
                    headway,
                    dwell,
                    dirs,
                    missing as u8 as f64,
                    (managed && (fleet == 0.0 || fleet.is_nan())) as u8 as f64,
                ]);
            }
            5 => {
                let dir = r.f();
                let count = r.u();
                let points = (0..count).map(|_| point(r.f(), r.f())).collect::<Vec<_>>();
                let mut area = 0.0;
                for p in points.windows(2) {
                    area += p[0].num("x") * p[1].num("y") - p[1].num("x") * p[0].num("y");
                }
                out.push(if if area >= 0.0 { dir == 1.0 } else { dir == -1.0 } {
                    1.0
                } else {
                    0.0
                });
            }
            6 => {
                let looped = r.f() != 0.0;
                let dir = r.u();
                out.push(if looped && dir == 2 {
                    1.0
                } else if looped && dir == 3 {
                    2.0
                } else {
                    3.0
                });
            }
            7 => {
                let km = r.f();
                let rounded = (km - 1e-8).ceil();
                let index = [6.0, 11.0, 19.0, 27.0, 40.0, 999.0]
                    .iter()
                    .position(|v| rounded <= *v)
                    .unwrap_or(5);
                out.push(if km <= 1e-9 { -1.0 } else { index as f64 });
            }
            8 => {
                let purpose = r.u();
                let minutes = r.f();
                let walk = r.f();
                let price = r.f();
                let km = r.f();
                let value = match purpose {
                    0 => 40.0,
                    2 => 20.0,
                    _ => 25.0,
                };
                let rail = minutes + walk * 1.7 + price / value;
                let road = 8.0 + km / 23.0 * 60.0 * 1.22 + (120.0 + km * 18.0) / value;
                let walking = km * 1.25 / 4.8 * 60.0;
                let alternative = min(road, walking);
                out.extend([
                    0.98 / (1.0
                        + crate::demand::raw_exp(max(
                            -40.0,
                            min(40.0, 0.12 * (rail - alternative)),
                        ))),
                    rail,
                    alternative,
                ]);
            }
            _ => panic!("unknown geometry operation"),
        }
        c.output = out;
        c.output.as_ptr()
    })
}
