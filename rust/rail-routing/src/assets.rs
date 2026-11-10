//! Cold construction and depot transactions. Commands, quotes and cash changes share a candidate.
use crate::{editor as E, editor_support::*, value::Value as V};
fn cars(s: &V) -> f64 {
    s.get("services")
        .array()
        .iter()
        .fold(0.0, |a, l| a + l.num("fleet") * l.num("cars"))
}
fn served(s: &V) -> Vec<V> {
    unique(
        &s.get("services")
            .array()
            .iter()
            .flat_map(|l| l.get("stops").array().to_vec())
            .collect::<Vec<_>>(),
    )
}
fn vehicle_value(s: &V, cfg: &V) -> f64 {
    if s.get("depot").truth() {
        s.get("depot")
            .get("stock")
            .entries()
            .iter()
            .fold(0.0, |a, (k, v)| {
                a + cfg.get("specs").get(k).zero("price") * v.n()
            })
    } else {
        s.get("services").array().iter().fold(0.0, |a, l| {
            a + l.num("fleet") * l.num("cars") * cfg.get("balance").num("CAR")
        })
    }
}
fn facility_value(s: &V, cfg: &V) -> f64 {
    s.get("urban")
        .get("facilities")
        .array()
        .iter()
        .filter(|f| !f.get("system").truth())
        .fold(0.0, |a, f| {
            a + cfg
                .get("facilityTypes")
                .get(f.get("kind").text())
                .get("price")
                .array()
                .get((f.num("level") - 1.0) as usize)
                .unwrap_or(&V::Missing)
                .n()
        })
}
fn quote(a: &V, b: &V, cfg: &V) -> V {
    let added = b
        .get("tracks")
        .array()
        .iter()
        .filter(|t| {
            !a.get("tracks")
                .array()
                .iter()
                .any(|x| same(x.get("id"), t.get("id")))
        })
        .fold(0.0, |v, t| v + t.num("km"));
    let removed = a
        .get("tracks")
        .array()
        .iter()
        .filter(|t| {
            !b.get("tracks")
                .array()
                .iter()
                .any(|x| same(x.get("id"), t.get("id")))
        })
        .fold(0.0, |v, t| v + t.num("km"));
    let sa = served(a);
    let sb = served(b);
    let added_st = sb
        .iter()
        .filter(|id| !sa.iter().any(|x| same(x, id)))
        .count() as f64;
    let removed_st = sa
        .iter()
        .filter(|id| !sb.iter().any(|x| same(x, id)))
        .count() as f64;
    let dv = vehicle_value(b, cfg) - vehicle_value(a, cfg);
    let df = facility_value(b, cfg) - facility_value(a, cfg);
    let track = cfg.get("balance").num("TRACK");
    let station = cfg.get("balance").num("STATION");
    let construction = added * track + added_st * station + max(0.0, dv) + max(0.0, df);
    let salvage = removed * track * 0.2
        + removed_st * station * 0.2
        + max(0.0, -dv) * 0.5
        + max(0.0, -df) * 0.2;
    obj(&[
        ("construction", n(construction)),
        ("salvage", n(salvage)),
        ("net", n(construction - salvage)),
        ("addedKm", n(added)),
        ("addedStations", n(added_st)),
        ("deltaCars", n(cars(b) - cars(a))),
    ])
}
fn record(e: &mut V, label: &str, amount: f64) {
    let row = obj(&[
        ("minute", e.get("minute").clone()),
        ("type", text(label)),
        ("amount", n(amount)),
    ]);
    let rows = e.get_mut("ledger").array_mut();
    rows.insert(0, row);
    rows.truncate(80);
}
fn init(s: &mut V, cfg: &V) {
    if !s.get("economy").truth() {
        s.set(
            "economy",
            obj(&[
                ("balanceVersion", cfg.get("balance").get("VERSION").clone()),
                ("operatingGrant", n(0.0)),
                ("infrastructureRebate", n(0.0)),
                ("cash", n(5e9)),
                ("loans", arr(vec![])),
                ("nextLoan", n(1.0)),
                ("construction", n(0.0)),
                ("salvage", n(0.0)),
                ("revenue", n(0.0)),
                ("operating", n(0.0)),
                ("interestPaid", n(0.0)),
                ("principalPaid", n(0.0)),
                ("arrears", n(0.0)),
                ("blocked", boolean(false)),
                ("minute", n(420.0)),
                (
                    "ledger",
                    arr(vec![obj(&[
                        ("minute", n(420.0)),
                        ("type", text("初始资金")),
                        ("amount", n(5e9)),
                    ])]),
                ),
            ]),
        );
    }
    if !eq(
        s.get("economy").get("balanceVersion"),
        cfg.get("balance").get("VERSION"),
    ) {
        let rebate = s.get("tracks").array().iter().fold(0.0, |v, t| {
            v + t.num("km") * (200e6 - cfg.get("balance").num("TRACK"))
        }) + served(s).len() as f64 * (80e6 - cfg.get("balance").num("STATION"))
            + cars(s) * (5e6 - cfg.get("balance").num("CAR"));
        let e = s.get_mut("economy");
        if !finite(e.get("operatingGrant")) {
            e.set("operatingGrant", n(0.0));
        }
        e.set(
            "infrastructureRebate",
            n(if finite(e.get("infrastructureRebate")) {
                e.num("infrastructureRebate")
            } else {
                0.0
            } + rebate),
        );
        e.set("cash", n(e.num("cash") + rebate));
        e.set("balanceVersion", cfg.get("balance").get("VERSION").clone());
        if rebate > 0.0 {
            record(e, "建设成本调整返还", rebate);
        }
    }
}
fn economy_valid(s: &V) -> bool {
    let e = s.get("economy");
    let positive = |v: &V| finite(v) && v.n() >= 0.0;
    if !e.truth()
        || ![
            "cash",
            "construction",
            "salvage",
            "revenue",
            "operating",
            "operatingGrant",
            "infrastructureRebate",
            "interestPaid",
            "principalPaid",
            "arrears",
            "minute",
        ]
        .iter()
        .all(|k| positive(e.get(k)))
        || e.num("minute") < 420.0
        || e.num("minute") > 1e8
        || !matches!(e.get("loans"), V::Array(_))
        || e.get("loans").array().len() > 3
        || !integer(e.get("nextLoan"))
        || !matches!(e.get("blocked"), V::Bool(_))
        || !matches!(e.get("ledger"), V::Array(_))
        || e.get("ledger").array().len() > 80
    {
        return false;
    }
    let mut total = 0.0;
    for l in e.get("loans").array() {
        if !integer(l.get("id"))
            || !["principal", "interest", "initial", "nextDue", "installment"]
                .iter()
                .all(|k| positive(l.get(k)))
            || l.num("initial") > 1e9
            || l.num("initial") < 1e8
            || l.num("principal") > l.num("initial") + 0.01
        {
            return false;
        }
        total += l.num("principal");
    }
    total <= 3e9 + 0.01
}
pub(super) fn configure(l: &mut V, d: &V, cfg: &V) -> Result<V, String> {
    if !d.truth()
        || !["manual", "auto"].contains(&d.get("mode").text())
        || !["manual", "offPeak", "peak"]
            .iter()
            .all(|k| E::count(d.get(k)))
    {
        return Err("投放数量须为 0—80 的偶数列，双向运营各半分配。".into());
    }
    if d.num("peak") < d.num("offPeak") {
        return Err("高峰投放不能少于平峰。".into());
    }
    l.set("dispatch", d.clone());
    l.set(
        "fleet",
        if d.get("mode").text() == "auto" {
            n(max(d.num("peak"), d.num("offPeak")))
        } else {
            d.get("manual").clone()
        },
    );
    if !E::valid_fleet_line(l, cfg) {
        return Err("每个交路至少需要双向各 1 列，请增加投放或减少交路。".into());
    }
    Ok(obj(&[]))
}
fn purchase(s: &mut V, a: &V, cfg: &V) -> Result<V, String> {
    let spec = a.get("spec");
    let amount = a.get("count");
    if !s.get("depot").truth()
        || !cfg.get("specs").get(spec.text()).truth()
        || !integer(amount)
        || amount.n() < 1.0
        || amount.n() > 80.0
        || s.get("depot").get("stock").zero(spec.text()) + amount.n() > 2400.0
    {
        return Err("请选择有效车型和 1—80 列购买数量。".into());
    }
    let stock = s.get_mut("depot").get_mut("stock");
    stock.set(spec.text(), n(stock.num(spec.text()) + amount.n()));
    Ok(obj(&[("spec", spec.clone()), ("count", amount.clone())]))
}
fn urban_init(s: &mut V) {
    if !s.get("urban").truth() {
        let minute = if matches!(s.get("economy").get("minute"), V::Missing | V::Null) {
            420.0
        } else {
            s.get("economy").num("minute")
        };
        s.set(
            "urban",
            obj(&[
                ("version", n(19.0)),
                ("revision", n(0.0)),
                ("step", n(0.0)),
                ("lastMinute", n(minute)),
                ("started", n(minute)),
                ("cells", obj(&[])),
                ("facilities", arr(vec![])),
                ("nextId", n(1.0)),
                ("history", arr(vec![])),
                (
                    "totals",
                    obj(&[
                        ("people", n(0.0)),
                        ("jobs", n(0.0)),
                        ("shops", n(0.0)),
                        ("industry", n(0.0)),
                        ("leisure", n(0.0)),
                    ]),
                ),
            ]),
        );
    }
}
fn facility(s: &mut V, op: &str, a: &V, cfg: &V) -> Result<V, String> {
    if op == "plan" {
        urban_init(s);
    }
    let u = s.get("urban");
    if u.get("facilityMode").text() == "automatic" {
        return Err(match op {
            "plan" => "城市设施由系统建设，请规划地铁接驳。",
            "upgrade" => "设施由系统自动升级。",
            _ => "系统城市设施不可拆除。",
        }
        .into());
    }
    let result =
        match op {
            "plan" => {
                let p = a.get("point");
                let kind = a.get("kind");
                if !cfg.get("facilityTypes").get(kind.text()).truth()
                    || !a.get("land").truth()
                    || !finite(p.get("x"))
                    || !finite(p.get("y"))
                    || p.num("x") < 25.0
                    || p.num("y") < 25.0
                    || p.num("x") > s.get("world").num("width") - 25.0
                    || p.num("y") > s.get("world").num("height") - 25.0
                {
                    return Err("请在可开发陆地区域规划设施。".into());
                }
                if u.get("facilities").array().len() >= 160 {
                    return Err("最多规划160座市政设施。".into());
                }
                if u.get("facilities").array().iter().any(|f| {
                    eq(f.get("kind"), kind) && crate::editor_geometry::distance(f, p) < 0.22
                }) {
                    return Err("同类设施过近，请升级已有设施或换一个位置。".into());
                }
                let id = text(&format!("u{}", jsstring(u.get("nextId"))));
                let opened = if matches!(s.get("economy").get("minute"), V::Missing | V::Null) {
                    n(420.0)
                } else {
                    s.get("economy").get("minute").clone()
                };
                let f = obj(&[
                    ("id", id.clone()),
                    ("kind", kind.clone()),
                    ("level", n(1.0)),
                    ("x", p.get("x").clone()),
                    ("y", p.get("y").clone()),
                    ("opened", opened),
                ]);
                let u = s.get_mut("urban");
                u.set("nextId", n(u.num("nextId") + 1.0));
                u.get_mut("facilities").array_mut().push(f);
                obj(&[("facilityId", id)])
            }
            "upgrade" => {
                let i = index_id(u.get("facilities"), a.get("id")).ok_or("设施不存在。")?;
                if u.get("facilities").array()[i].num("level") >= 3.0 {
                    return Err("已达最高等级。".into());
                }
                let f = &mut s.get_mut("urban").get_mut("facilities").array_mut()[i];
                f.set("level", n(f.num("level") + 1.0));
                obj(&[])
            }
            "remove" => {
                if index_id(u.get("facilities"), a.get("id")).is_none() {
                    return Err("设施不存在。".into());
                }
                s.get_mut("urban")
                    .get_mut("facilities")
                    .array_mut()
                    .retain(|f| !eq(f.get("id"), a.get("id")));
                obj(&[])
            }
            _ => return Err("未知的设施命令。".into()),
        };
    let u = s.get_mut("urban");
    u.set("revision", n(u.num("revision") + 1.0));
    Ok(result)
}
fn execute(s: &mut V, command: &V, cfg: &V) -> Result<V, String> {
    let op = command.get("op").text();
    let a = command.get("args");
    match command.get("kind").text() {
        "network" => {
            let result = E::command(s, op, a, cfg)?;
            if !E::validate(s, cfg) {
                return Err("线路配置无效，操作未保存。".into());
            }
            Ok(result)
        }
        "fleet" => match op {
            "purchase" => purchase(s, a, cfg),
            _ => Err("未知的车库命令。".into()),
        },
        "facility" => facility(s, op, a, cfg),
        _ => Err("未知的资产命令。".into()),
    }
}
fn recommend(s: &V, l: &V, daily: f64, cfg: &V) -> V {
    let capacity = cfg
        .get("specs")
        .get(l.get("stockSpec").text())
        .num("capacity");
    let stops = l.get("stops").array();
    let duration = l.get("trackIds").array().iter().fold(0.0, |v, id| {
        v + s
            .get("tracks")
            .array()
            .iter()
            .find(|t| eq(t.get("id"), id))
            .unwrap_or(&V::Missing)
            .num("km")
            / 48.0
            * 60.0
    }) + (stops.len() as f64 - 1.0) * 0.6;
    let cycle = if same(first(stops), last(stops)) {
        duration
            * if l.get("loopDirection").truth() && l.get("loopDirection").text() != "both" {
                1.0
            } else {
                2.0
            }
    } else {
        2.0 * (duration + 1.0)
    };
    let minimum = 2.0 * max(1.0, l.get("patterns").array().len() as f64);
    let available = max(
        0.0,
        min(
            80.0,
            ((s.get("depot").get("stock").zero(l.get("stockSpec").text())
                - E::reserved(s, l.get("stockSpec"), l.get("id")))
                / 2.0)
                .floor()
                * 2.0,
        ),
    );
    let need = |share: f64| {
        max(
            minimum,
            (cycle
                * min(
                    30.0,
                    max(
                        if share == 0.18 { 6.0 } else { 3.0 },
                        max(0.0, daily) * share * 0.65 / (capacity * 0.8),
                    ),
                )
                / 60.0
                / 2.0)
                .ceil()
                * 2.0,
        )
    };
    let off = need(0.06);
    let peak = need(0.18);
    let take = |v| {
        if available < minimum {
            0.0
        } else {
            min(available, v)
        }
    };
    obj(&[
        ("offPeak", n(take(off))),
        ("peak", n(take(peak))),
        ("offNeed", n(off)),
        ("peakNeed", n(peak)),
        ("available", n(available)),
    ])
}
fn inner(input: &V, cfg: &V) -> Result<V, String> {
    let before = input.get("state");
    let op = input.get("op").text();
    let a = input.get("args");
    let mut s = before.clone();
    let result = match op {
        "init" => {
            init(&mut s, cfg);
            obj(&[])
        }
        "quote" => return Ok(obj(&[("result", quote(before, input.get("after"), cfg))])),
        "validateEconomy" => return Ok(obj(&[("result", boolean(economy_valid(before)))])),
        "validateFleet" => return Ok(obj(&[("result", boolean(E::valid_fleet(before, cfg)))])),
        "validLine" => {
            return Ok(obj(&[(
                "result",
                boolean(E::valid_fleet_line(a.get("line"), cfg)),
            )]))
        }
        "vehicleValue" => return Ok(obj(&[("result", n(vehicle_value(before, cfg)))])),
        "facilityValue" => return Ok(obj(&[("result", n(facility_value(before, cfg)))])),
        "reserved" | "free" => {
            let r = E::reserved(before, a.get("spec"), a.get("except"));
            return Ok(obj(&[(
                "result",
                n(if op == "free" {
                    before.get("depot").get("stock").zero(a.get("spec").text()) - r
                } else {
                    r
                }),
            )]));
        }
        "recommend" => {
            return Ok(obj(&[(
                "result",
                recommend(before, a.get("line"), a.num("daily"), cfg),
            )]))
        }
        "municipalTransfer" => {
            let refund = facility_value(&s, cfg);
            for f in s.get_mut("urban").get_mut("facilities").array_mut() {
                f.set("system", boolean(true));
                if !f.get("name").truth() {
                    f.set(
                        "name",
                        cfg.get("facilityTypes")
                            .get(f.get("kind").text())
                            .get("name")
                            .clone(),
                    );
                }
            }
            if refund != 0.0 && s.get("economy").truth() {
                let e = s.get_mut("economy");
                e.set("cash", n(e.num("cash") + refund));
                e.set(
                    "infrastructureRebate",
                    n(e.zero("infrastructureRebate") + refund),
                );
                record(e, "市政移交 · 退还设施投资", refund);
            }
            obj(&[])
        }
        "fleetUpgrade" => {
            E::fleet_upgrade(&mut s, cfg);
            obj(&[])
        }
        "purchase" => purchase(&mut s, a, cfg)?,
        "configureFleet" => {
            let mut l = a.get("line").clone();
            let result = configure(&mut l, a.get("dispatch"), cfg)?;
            return Ok(obj(&[("result", result), ("line", l)]));
        }
        "plan" | "upgradeFacility" | "removeFacility" => facility(
            &mut s,
            match op {
                "upgradeFacility" => "upgrade",
                "removeFacility" => "remove",
                _ => "plan",
            },
            a,
            cfg,
        )?,
        "transaction" | "finalize" => {
            let result = if op == "transaction" {
                execute(&mut s, input.get("command"), cfg)?
            } else {
                s = input.get("after").clone();
                input.get("result").clone()
            };
            if !E::valid_fleet(&s, cfg) {
                return Err("车辆库存或配属无效，操作未保存。".into());
            }
            let q = quote(before, &s, cfg);
            if [
                "construction",
                "salvage",
                "net",
                "addedKm",
                "addedStations",
                "deltaCars",
            ]
            .iter()
            .any(|k| !finite(q.get(k)))
                || (input.get("commit").truth() && !economy_valid(before))
            {
                return Err("资产或财务数据无效，操作未保存。".into());
            }
            if input.get("commit").truth() {
                if q.num("net") > before.get("economy").num("cash") + 0.01 {
                    return Ok(obj(&[(
                        "result",
                        obj(&[("insufficient", q.get("net").clone())]),
                    )]));
                }
                // The candidate cannot forge accounts through a host callback.
                s.set("economy", input.get("accounts").clone());
                let e = s.get_mut("economy");
                e.set("cash", n(max(0.0, e.num("cash") - q.num("net"))));
                e.set(
                    "construction",
                    n(e.num("construction") + q.num("construction")),
                );
                e.set("salvage", n(e.num("salvage") + q.num("salvage")));
                record(
                    e,
                    if q.num("net") >= 0.0 {
                        "建设与车辆投入"
                    } else {
                        "资产回收"
                    },
                    -q.num("net"),
                );
            }
            return Ok(obj(&[
                ("result", result),
                ("quote", q),
                (
                    "patch",
                    crate::editor_delta::project(
                        if op == "finalize" {
                            input.get("after")
                        } else {
                            before
                        },
                        &s,
                    ),
                ),
            ]));
        }
        _ => return Err("未知的资产查询。".into()),
    };
    Ok(obj(&[
        ("result", result),
        ("patch", crate::editor_delta::project(before, &s)),
    ]))
}
pub(super) fn run(input: &V, cfg: &V) -> V {
    inner(input, cfg).unwrap_or_else(|error| obj(&[("result", obj(&[("error", text(&error))]))]))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dispatch_failure_does_not_commit_a_partial_line() {
        let cfg = obj(&[("specs", obj(&[("6B", obj(&[("cars", n(6.0))]))]))]);
        let line = obj(&[
            ("fleetManaged", boolean(true)),
            ("stockSpec", text("6B")),
            ("cars", n(6.0)),
            ("fleet", n(4.0)),
            ("patterns", arr(vec![obj(&[]), obj(&[])])),
        ]);
        let input = obj(&[
            ("op", text("configureFleet")),
            ("state", obj(&[])),
            (
                "args",
                obj(&[
                    ("line", line.clone()),
                    (
                        "dispatch",
                        obj(&[
                            ("mode", text("manual")),
                            ("manual", n(2.0)),
                            ("offPeak", n(2.0)),
                            ("peak", n(2.0)),
                        ]),
                    ),
                ]),
            ),
        ]);
        let out = run(&input, &cfg);
        assert!(out.get("result").get("error").truth());
        assert!(!out.get("line").truth());
        assert_eq!(line.num("fleet"), 4.0);
    }
}

#[no_mangle]
pub extern "C" fn assets_abi() -> u32 {
    1
}
