//! Persistent revision routing. The host callback only encodes standard JSON/UTF-8.
use crate::{
    migration::Routing,
    value::{object, Value as V},
};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
};
pub(super) struct Context {
    router: Routing,
    pub names: Vec<String>,
    pub purposes: Vec<String>,
    pub ids: HashMap<String, usize>,
    sent: HashSet<(usize, String)>,
}
impl Context {
    pub fn new(v: V) -> Self {
        let mut router = Routing::new(v.get("graph").clone());
        router.seed(v.get("routes"));
        router.seed_trees(v.get("trees"));
        let mut out = Self {
            router,
            names: vec![],
            purposes: vec![],
            ids: HashMap::new(),
            sent: HashSet::new(),
        };
        out.update(&v);
        for p in v.get("paths").array() {
            out.sent
                .insert((p.array()[0].n() as usize, p.array()[1].text().to_string()));
        }
        out
    }
    pub fn update(&mut self, v: &V) {
        self.router.update_weights(v.get("weights"));
        self.names = v
            .get("names")
            .array()
            .iter()
            .map(|x| x.text().to_string())
            .collect();
        self.purposes = v
            .get("purposes")
            .array()
            .iter()
            .map(|x| x.text().to_string())
            .collect();
        self.ids = self
            .names
            .iter()
            .enumerate()
            .map(|(i, s)| (s.clone(), i))
            .collect();
    }
    pub fn refresh(&mut self, rows: &[(usize, f64, f64)]) {
        let rows = V::Array(
            rows.iter()
                .map(|(id, h, d)| {
                    V::Array(vec![
                        V::String(self.names[*id].clone()),
                        V::Number(*h),
                        V::Number(*d),
                    ])
                })
                .collect(),
        );
        self.router.update_weights(&rows);
    }
    pub fn resolve(&mut self, source: &V, station: usize, id: usize) -> (Option<V>, V) {
        let next = self.router.route(source, station, id);
        let purpose = source.get("purpose").text().to_string();
        let trees = if self.sent.insert((station, purpose.clone())) {
            self.router.tree(station, &purpose).map_or(vec![], |data| {
                vec![V::Array(vec![
                    V::Number(station as f64),
                    V::String(purpose),
                    V::Array(data.iter().map(|x| V::Number(*x)).collect()),
                    V::Array(self.router.weights().into_iter().map(V::Number).collect()),
                ])]
            })
        } else {
            vec![]
        };
        let payload = object([
            ("journey", next.clone().unwrap_or(V::Null)),
            (
                "cacheKey",
                V::Array(vec![
                    V::Number(station as f64),
                    source.get("to").clone(),
                    source.get("purpose").clone(),
                    source.get("fare").clone(),
                ]),
            ),
            ("trees", V::Array(trees)),
        ]);
        (next, payload)
    }
}
#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "rail_host")]
extern "C" {
    fn json_utf8(input: *const f64, len: usize, output: *mut u8, capacity: usize) -> usize;
}
pub(super) fn key(j: &V) -> Rc<str> {
    let fields = [
        "legs",
        "from",
        "to",
        "purpose",
        "back",
        "hub",
        "externalKind",
        "fare",
        "byLine",
    ];
    let value = V::Array(fields.iter().map(|k| j.get(k).clone()).collect());
    #[cfg(target_arch = "wasm32")]
    unsafe {
        let data = crate::value::write(&value);
        let n = json_utf8(data.as_ptr(), data.len(), std::ptr::null_mut(), 0);
        let mut bytes = vec![0; n];
        assert_eq!(
            json_utf8(data.as_ptr(), data.len(), bytes.as_mut_ptr(), n),
            n
        );
        Rc::from(std::str::from_utf8(&bytes).unwrap())
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = value;
        panic!("JSON codec is provided by the WASM host")
    }
}
