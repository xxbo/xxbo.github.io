//! Exact editor result projection. Unchanged values use source indices, never hashes.
use super::editor_support::*;
use crate::value::Value as V;
const FIELDS: [&str; 7] = [
    "nodes",
    "tracks",
    "services",
    "nextId",
    "depot",
    "mapVersion",
    "routeModel",
];
fn equal(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Missing, V::Missing) | (V::Null, V::Null) => true,
        (V::Number(a), V::Number(b)) => a.to_bits() == b.to_bits(),
        (V::Bool(a), V::Bool(b)) => a == b,
        (V::String(a), V::String(b)) => a == b,
        (V::Array(a), V::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        (V::Object(a), V::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .zip(b)
                    .all(|(a, b)| a.0 == b.0 && equal(&a.1, &b.1))
        }
        _ => false,
    }
}
fn key(v: &V) -> Option<String> {
    match v {
        V::String(s) => Some(format!("s:{s}")),
        V::Number(x) => Some(format!(
            "n:{:016x}",
            if *x == 0.0 { 0 } else { x.to_bits() }
        )),
        _ => None,
    }
}
pub(super) fn project(before: &V, after: &V) -> V {
    let mut rows = vec![];
    for (k, value) in after.entries() {
        if !FIELDS.contains(&k.as_str()) {
            continue;
        }
        let old = before.get(k);
        let (mode, payload) = if has(before, k) && equal(old, value) {
            (0.0, V::Null)
        } else if ["nodes", "tracks", "services"].contains(&k.as_str())
            && matches!(value, V::Array(_))
        {
            let mut ids = std::collections::HashMap::<String, Vec<usize>>::new();
            for (i, v) in old.array().iter().enumerate() {
                if let Some(k) = key(v.get("id")) {
                    ids.entry(k).or_default().push(i);
                }
            }
            let entries = value
                .array()
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let at = if old.array().get(i).map_or(false, |x| equal(x, v)) {
                        Some(i)
                    } else {
                        key(v.get("id"))
                            .and_then(|k| ids.get(&k))
                            .and_then(|candidates| {
                                candidates
                                    .iter()
                                    .copied()
                                    .find(|&ix| equal(&old.array()[ix], v))
                            })
                    };
                    if let Some(i) = at {
                        arr(vec![n(i as f64)])
                    } else {
                        arr(vec![n(-1.0), v.clone()])
                    }
                })
                .collect();
            (1.0, arr(entries))
        } else {
            (2.0, value.clone())
        };
        rows.push(arr(vec![text(k), n(mode), payload]));
    }
    arr(rows)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reordered_arrays_keep_exact_source_indices() {
        let a = obj(&[(
            "tracks",
            arr(vec![
                obj(&[("id", text("t1")), ("km", n(1.0))]),
                obj(&[("id", text("t2")), ("km", n(2.0))]),
            ]),
        )]);
        let b = obj(&[("tracks", arr(vec![a.get("tracks").array()[1].clone()]))]);
        let p = project(&a, &b);
        assert_eq!(p.array()[0].array()[2].array()[0].array()[0].n(), 1.0);
    }
    #[test]
    fn field_order_and_nonfinite_bits_are_not_discarded() {
        let a = obj(&[("nextId", n(-0.0))]);
        let b = obj(&[("nextId", n(0.0))]);
        assert_eq!(project(&a, &b).array()[0].array()[1].n(), 2.0);
        let a = obj(&[(
            "tracks",
            arr(vec![obj(&[("id", text("t1")), ("km", n(1.0))])]),
        )]);
        let b = obj(&[(
            "tracks",
            arr(vec![obj(&[("km", n(1.0)), ("id", text("t1"))])]),
        )]);
        assert_eq!(
            project(&a, &b).array()[0].array()[2].array()[0].array()[0].n(),
            -1.0
        );
    }
}
