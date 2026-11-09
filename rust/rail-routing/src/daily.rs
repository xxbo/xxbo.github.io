//! Operating-day query aggregation; names, colors and locale sorting remain UI projections.
use crate::value::{object, Value as V};
use std::collections::HashMap;
fn n(v: f64) -> V {
    V::Number(v)
}
fn max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}
pub(super) fn query(input: &V) -> V {
    let s = input.get("state");
    let rt = input.get("runtime");
    let minute = rt.num("minute");
    let day = crate::history::day(minute);
    let supplied = s.get("ridership").get("current");
    let fallback = object([
        ("number", n(day)),
        ("completed", n(0.0)),
        ("boarded", n(0.0)),
        ("lines", V::Object(vec![])),
    ]);
    let d = if supplied.num("number") == day {
        supplied
    } else {
        &fallback
    };
    let tracks = s.get("tracks").array();
    let services = s.get("services").array();
    let mut km = HashMap::new();
    for t in tracks {
        km.insert(t.get("id").text(), t.num("km"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut network = 0.0;
    let mut lengths = vec![];
    for l in services {
        let mut sum = 0.0;
        for id in l.get("trackIds").array() {
            let v = km.get(id.text()).copied().unwrap_or(0.0);
            let v = if v.is_nan() || v == 0.0 { 0.0 } else { v };
            sum += v;
            if seen.insert(id.text()) {
                network += v;
            }
        }
        lengths.push(sum);
    }
    let mut loads = HashMap::<&str, [f64; 4]>::new();
    for t in rt.get("trains").array() {
        let id = if t.get("parentLine").truth() {
            t.get("parentLine").text()
        } else {
            t.get("service").text()
        };
        let r = loads.entry(id).or_insert([0.0; 4]);
        let capacity = t.num("capacity");
        let onboard = t.num("onboard");
        r[0] += onboard;
        r[1] += capacity;
        r[2] += 1.0;
        r[3] = max(
            r[3],
            if capacity != 0.0 {
                onboard / capacity
            } else {
                0.0
            },
        );
    }
    let grant = input.num("grant");
    let mut rows = vec![];
    for (i, l) in services.iter().enumerate() {
        let id = l.get("id").text();
        let st = d.get("lines").get(id);
        let load = loads.get(id);
        let revenue = st.zero("revenue");
        let operating = st.zero("operating");
        let length = lengths[services
            .iter()
            .rposition(|v| v.get("id").text() == id)
            .unwrap_or(i)];
        rows.push(object([
            ("id", l.get("id").clone()),
            ("km", n(length)),
            ("riders", n(st.zero("boarded"))),
            ("completed", n(st.zero("completed"))),
            (
                "load",
                load.filter(|v| v[1] != 0.0)
                    .map_or(V::Null, |v| n(v[0] / v[1])),
            ),
            ("maxLoad", load.map_or(V::Null, |v| n(v[3]))),
            ("trains", n(load.map_or(0.0, |v| v[2]))),
            (
                "intensity",
                n(if length != 0.0 {
                    st.zero("boarded") / length
                } else {
                    0.0
                }),
            ),
            ("passengerKm", n(st.zero("passengerKm"))),
            ("revenue", n(revenue)),
            ("grant", n(revenue * grant)),
            ("operating", n(operating)),
            ("profit", n(revenue * (1.0 + grant) - operating)),
        ]));
    }
    let since = d.get("metricsSince");
    let partial = if matches!(since, V::Missing | V::Null) {
        minute
    } else {
        since.n()
    } > 420.0 + (day - 1.0) * 1440.0 + 0.01;
    object([
        ("day", n(day)),
        ("completed", n(d.zero("completed"))),
        ("boarded", n(d.zero("boarded"))),
        ("networkKm", n(network)),
        ("passengerKm", n(d.zero("passengerKm"))),
        ("revenue", n(d.zero("revenue"))),
        ("operating", n(d.zero("operating"))),
        (
            "profit",
            n(d.zero("revenue") * (1.0 + grant) - d.zero("operating")),
        ),
        ("partial", V::Bool(partial)),
        ("metricsSince", since.clone()),
        ("rows", V::Array(rows)),
    ])
}
