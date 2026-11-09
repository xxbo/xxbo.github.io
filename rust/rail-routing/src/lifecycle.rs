//! Persistent daily history owned beside operating statistics. JS receives ordered view commands.
use crate::queues::Read;
use crate::value::{object, Value as V};
const NET: [&str; 7] = [
    "attempted",
    "completed",
    "rejected",
    "boarded",
    "waitMinutes",
    "revenue",
    "passengerKm",
];
const RECORDS: [&str; 6] = [
    "totalCompleted",
    "totalPassengerKm",
    "bestDay",
    "bestDayNumber",
    "bestHour",
    "bestHourMinute",
];
const LINE: [&str; 9] = [
    "attempted",
    "completed",
    "rejected",
    "boarded",
    "waitMinutes",
    "revenue",
    "passengerKm",
    "vehicleKm",
    "operating",
];
const FEED: [&str; 5] = ["attempted", "lost", "wait", "boarded", "bestDay"];
const STATION: [&str; 3] = ["entered", "boarded", "alighted"];
fn num(n: f64) -> V {
    V::Number(n)
}
pub(super) struct Life {
    pub data: V,
    names: Vec<String>,
}
fn row(fields: &[&str]) -> V {
    V::Object(fields.iter().map(|k| (k.to_string(), num(0.0))).collect())
}
impl Life {
    pub fn read(r: &mut Read) -> Self {
        let input = crate::value::read(r);
        Self {
            data: input.get("data").clone(),
            names: input
                .get("names")
                .array()
                .iter()
                .map(|v| v.text().to_string())
                .collect(),
        }
    }
    fn name(&self, id: usize) -> String {
        self.names.get(id).cloned().unwrap_or_default()
    }
    pub fn touch(&mut self, minute: f64) {
        let d = self.data.get_mut("current");
        Self::touch_day(d, minute);
    }
    fn touch_day(d: &mut V, minute: f64) {
        let base = 420.0 + (d.num("number") - 1.0) * 1440.0;
        if minute < base || minute > base + 1440.0 {
            return;
        }
        let f = d.get("flow");
        let valid = f.num("version") == 1.0
            && ["entered", "boarded", "completed"]
                .iter()
                .all(|k| f.get(k).array().len() == 96);
        if !valid {
            d.set(
                "flow",
                object([
                    ("version", num(1.0)),
                    ("since", num(minute)),
                    ("through", num(minute)),
                    ("entered", V::Array(vec![num(0.0); 96])),
                    ("boarded", V::Array(vec![num(0.0); 96])),
                    ("completed", V::Array(vec![num(0.0); 96])),
                ]),
            );
        }
        let f = d.get_mut("flow");
        f.set(
            "through",
            num(f.num("through").max((base + 1440.0).min(minute))),
        );
    }
    pub fn maturity(&mut self, id: usize, a: f64, t: f64) {
        let id = self.name(id);
        let line = self.data.get_mut("lines").get_mut(&id);
        line.set("awareness", num(a));
        line.set("trust", num(t));
    }
    pub fn archive(&mut self, number: f64, now: f64) -> Vec<f64> {
        let old = self.data.get("current");
        let boundary = 420.0 + (number - 1.0) * 1440.0;
        let adjacent = old.num("number") == number - 1.0;
        let continuous =
            adjacent && old.get("flow").truth() && old.get("flow").num("through") >= boundary - 1.0;
        if adjacent && old.get("flow").truth() {
            Self::touch_day(self.data.get_mut("current"), boundary);
        }
        let maturity = V::Object(
            self.data
                .get("lines")
                .entries()
                .iter()
                .map(|(id, l)| (id.clone(), num(l.num("awareness") * l.num("trust"))))
                .collect(),
        );
        let mut archived = self.data.get("current").clone();
        archived.set("maturity", maturity.clone());
        let history = self.data.get_mut("history").array_mut();
        history.push(archived);
        let drop = history.len().saturating_sub(30);
        history.drain(0..drop);
        let mut out = vec![
            43.0,
            number,
            boundary,
            if continuous { 1.0 } else { 0.0 },
            drop as f64,
            0.0,
            0.0,
            0.0,
        ];
        for (id, v) in maturity.entries() {
            let index = self
                .names
                .iter()
                .position(|s| s == id)
                .expect("history line ID missing");
            out.extend([44.0, index as f64, v.n(), 0.0, 0.0, 0.0, 0.0, 0.0]);
        }
        out.extend([45.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        self.data.set(
            "current",
            object([
                ("number", num(number)),
                ("revenue", num(0.0)),
                ("operating", num(0.0)),
                ("passengerKm", num(0.0)),
                ("metricsSince", num(boundary)),
                ("attempted", num(0.0)),
                ("completed", num(0.0)),
                ("rejected", num(0.0)),
                ("waitMinutes", num(0.0)),
                ("boarded", num(0.0)),
                ("lines", V::Object(vec![])),
                ("stations", V::Object(vec![])),
            ]),
        );
        self.touch(if continuous { boundary } else { now });
        self.touch(now);
        out
    }
    pub fn operating(&mut self, id: Option<usize>, value: f64) {
        if let Some(id) = id {
            let name = self.name(id);
            let line = self.data.get_mut("current").get_mut("lines").get_mut(&name);
            if matches!(line, V::Missing) {
                *line = row(&LINE[..5]);
            }
            line.set("operating", num(value));
        } else {
            self.data.get_mut("current").set("operating", num(value));
        }
    }
    pub fn apply(&mut self, commands: &[f64], now: f64) {
        self.touch(now);
        for r in commands.chunks_exact(8) {
            let op = r[0] as usize;
            let id = r[1] as usize;
            match op {
                32 | 33 | 34 | 35 | 36 | 37 => {
                    let name = self.name(id);
                    let target = match op {
                        32 => self.data.get_mut("current"),
                        33 => self.data.get_mut("records"),
                        34 => {
                            let v = self.data.get_mut("current").get_mut("lines").get_mut(&name);
                            if matches!(v, V::Missing) {
                                *v = row(&LINE[..5]);
                            }
                            v
                        }
                        35 => self.data.get_mut("lines").get_mut(&name),
                        36 => {
                            let v = self
                                .data
                                .get_mut("current")
                                .get_mut("stations")
                                .get_mut(&id.to_string());
                            if matches!(v, V::Missing) {
                                *v = row(&STATION);
                            }
                            v
                        }
                        37 => self.data.get_mut("current").get_mut("flow"),
                        _ => unreachable!(),
                    };
                    let fields: &[&str] = match op {
                        32 => &NET,
                        33 => &RECORDS,
                        34 => &LINE,
                        35 => &FEED,
                        36 => &STATION,
                        _ => &["entered", "boarded", "completed"],
                    };
                    for p in [2, 4, 6] {
                        if r[p] < 0.0 {
                            break;
                        }
                        let field = fields[r[p] as usize];
                        if op == 37 {
                            let a = target.get_mut(field).array_mut();
                            if id < 96 {
                                a[id] = num(r[p + 1]);
                            }
                        } else {
                            target.set(field, num(r[p + 1]));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    pub fn snapshot(&self) -> V {
        object([
            ("current", self.data.get("current").clone()),
            ("history", self.data.get("history").clone()),
        ])
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_archive_keeps_extras_maturity_and_bounded_history() {
        let mut life = Life {
            names: vec!["line".into()],
            data: object([
                (
                    "current",
                    object([
                        ("number", num(1.0)),
                        ("extra", V::String("原始字段 😀".into())),
                    ]),
                ),
                ("history", V::Array(vec![])),
                (
                    "lines",
                    V::Object(vec![(
                        "line".into(),
                        object([("awareness", num(0.37)), ("trust", num(0.91))]),
                    )]),
                ),
            ]),
        };
        life.touch(420.0);
        life.touch(1859.9);
        let commands = life.archive(2.0, 1860.1);
        assert_eq!(&commands[..5], &[43.0, 2.0, 1860.0, 1.0, 0.0]);
        let history = life.data.get("history").array();
        assert_eq!(history[0].get("extra").text(), "原始字段 😀");
        assert_eq!(history[0].get("maturity").num("line"), 0.37 * 0.91);
        assert_eq!(life.data.get("current").get("flow").num("since"), 1860.0);
        for day in 3..40 {
            life.archive(day as f64, 420.0 + (day as f64 - 1.0) * 1440.0);
        }
        assert_eq!(life.data.get("history").array().len(), 30);
        assert_eq!(life.data.get("history").array()[0].num("number"), 9.0);
    }
}
