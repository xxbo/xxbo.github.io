//! Line connection summaries from scalar forecast records, without materializing paths.
use crate::value::{object, Value as V};
fn n(v: f64) -> V {
    V::Number(v)
}
fn add(v: &mut V, k: &str, x: f64) {
    let old = v.zero(k);
    v.set(k, n(old + x));
}
pub(super) fn run(v: &V) -> V {
    let stations = v.get("stations");
    let mut rows = V::Object(vec![]);
    let mut sets = std::collections::HashMap::<String, (Vec<usize>, Vec<usize>)>::new();
    for l in v.get("services").array() {
        let mut row = object([
            ("people", n(0.0)),
            ("jobs", n(0.0)),
            ("shops", n(0.0)),
            ("leisure", n(0.0)),
        ]);
        let mut stops = vec![];
        for id in l.get("stops").array() {
            let id = id.n() as usize;
            if stops.contains(&id) {
                continue;
            }
            stops.push(id);
            let st = stations.get(&id.to_string());
            for k in ["people", "jobs", "shops", "leisure"] {
                add(&mut row, k, st.zero(k));
            }
        }
        row.set(
            "purposes",
            object([("work", n(0.0)), ("shopping", n(0.0)), ("leisure", n(0.0))]),
        );
        for k in ["demand", "hub", "transfers", "shared", "travel"] {
            row.set(k, n(0.0));
        }
        let id = l.get("id").text();
        rows.set(id, row);
        sets.insert(id.into(), (vec![], vec![]));
    }
    for flow in v.get("flows").array() {
        let a = flow.array();
        let amount = a[4].n();
        let mut ids = vec![];
        for line in a[10].array() {
            let id = line.text();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        for id in ids {
            if !rows.get(id).truth() {
                continue;
            }
            let row = rows.get_mut(id);
            add(row, "demand", amount);
            add(row.get_mut("purposes"), a[2].text(), amount);
            add(row, "travel", amount * a[5].n());
            if a[6].truth() {
                add(row, "hub", amount)
            }
            if a[7].truth() {
                add(row, "transfers", amount)
            }
            if a[8].n() > 1.0 {
                add(row, "shared", amount)
            }
            let (homes, dests) = sets.get_mut(id).unwrap();
            let home = a[if a[3].truth() { 1 } else { 0 }].n() as usize;
            if !homes.contains(&home) {
                homes.push(home)
            }
            if a[2].text() == "work" && !a[9].text().starts_with("staff") {
                let dest = a[if a[3].truth() { 0 } else { 1 }].n() as usize;
                if !dests.contains(&dest) {
                    dests.push(dest)
                }
            }
        }
    }
    if let V::Object(items) = &mut rows {
        for (id, row) in items {
            let (homes, dests) = &sets[id];
            let jobs = dests
                .iter()
                .fold(0.0, |v, id| v + stations.get(&id.to_string()).zero("jobs"));
            let people = homes.iter().fold(0.0, |v, id| {
                v + stations.get(&id.to_string()).zero("people")
            });
            let demand = row.num("demand");
            row.set("reachableJobs", n(jobs));
            row.set("reachableHomes", n(people));
            for (key, total) in [
                ("minutes", "travel"),
                ("sharedShare", "shared"),
                ("transferShare", "transfers"),
            ] {
                row.set(
                    key,
                    n(if demand != 0.0 {
                        row.num(total) / demand
                    } else {
                        0.0
                    }),
                );
            }
            if let V::Object(fields) = row {
                fields.retain(|(k, _)| k != "travel");
            }
        }
    }
    rows
}
