//! Persistent service calendar. Host boundaries are world/history revisions, not minutes or departures.
use crate::{int, queues::Read, CORE};
struct Run {
    id: usize,
    parent: usize,
    base: f64,
    duration: f64,
    h0: f64,
    is_loop: bool,
    dirs: f64,
    calls: f64,
    open: f64,
    close: f64,
    managed: bool,
    off: f64,
    high: f64,
    parent_off: f64,
    parent_high: f64,
    fleet: f64,
    fares: Vec<usize>,
}
impl Run {
    fn h(&self) -> f64 {
        let cycle = if self.is_loop {
            self.duration * self.dirs
        } else {
            2.0 * (self.duration + 1.0)
        };
        if self.managed {
            if self.fleet == 0.0 {
                f64::INFINITY
            } else {
                crate::demand::max(2.0, cycle / self.fleet)
            }
        } else {
            crate::demand::max(self.h0, cycle / self.fleet)
        }
    }
    fn dwell(&self) -> f64 {
        if !self.is_loop {
            return 0.6;
        }
        let h = self.h();
        let n = crate::demand::max(1.0, (self.duration / h - 1e-8).ceil());
        0.6 + crate::demand::max(0.0, n * h - self.duration) / crate::demand::max(1.0, self.calls)
    }
    fn opened(&self, now: f64) -> bool {
        let d = ((now % 1440.0) + 1440.0) % 1440.0;
        d >= self.open && d < self.close
    }
}
struct Departure {
    run: usize,
    dir: f64,
    present: bool,
    next: f64,
    h: f64,
    last: Option<f64>,
}
pub(super) struct Calendar {
    sparse: bool,
    token: f64,
    catalog: f64,
    motion: f64,
    sampling: f64,
    blocks: usize,
    serial: usize,
    next: usize,
    fleet_minute: f64,
    carry: f64,
    remainder: f64,
    rng: f64,
    expected: f64,
    feedback_minute: f64,
    integer: bool,
    transfer: f64,
    runs: Vec<Run>,
    departures: Vec<Departure>,
    templates: Vec<f64>,
    feedback: Vec<f64>,
    sample: Vec<f64>,
    ids: Vec<usize>,
    mapping: Vec<f64>,
    line_offsets: Vec<usize>,
    run_offset: usize,
}
impl Calendar {
    fn read(v: &[f64], sampling_state: &mut Option<crate::simulation::Sampling>) -> Self {
        let mut r = Read { v, at: 0 };
        assert_eq!(r.f(), 1.0);
        let token = r.f();
        let catalog = r.f();
        let motion = r.f();
        let sampling = r.f();
        let blocks = r.u();
        let serial = r.u();
        let next = r.u();
        let fleet_minute = r.f();
        let carry = r.f();
        let remainder = r.f();
        let rng = r.f();
        let expected = r.f();
        let feedback_minute = r.f();
        let integer = r.f() != 0.0;
        let transfer = r.f();
        let n = r.u();
        let mut runs = Vec::with_capacity(n);
        for _ in 0..n {
            let id = r.u();
            let parent = r.u();
            let base = r.f();
            let duration = r.f();
            let h0 = r.f();
            let is_loop = r.f() != 0.0;
            let dirs = r.f();
            let calls = r.f();
            let open = r.f();
            let close = r.f();
            let managed = r.f() != 0.0;
            let off = r.f();
            let high = r.f();
            let parent_off = r.f();
            let parent_high = r.f();
            let fleet = r.f();
            let fares = (0..r.u()).map(|_| r.u()).collect();
            runs.push(Run {
                id,
                parent,
                base,
                duration,
                h0,
                is_loop,
                dirs,
                calls,
                open,
                close,
                managed,
                off,
                high,
                parent_off,
                parent_high,
                fleet,
                fares,
            });
        }
        let departures = (0..r.u())
            .map(|_| Departure {
                run: r.u(),
                dir: r.f(),
                present: r.f() != 0.0,
                next: r.f(),
                h: r.f(),
                last: {
                    let yes = r.f() != 0.0;
                    let x = r.f();
                    if yes {
                        Some(x)
                    } else {
                        None
                    }
                },
            })
            .collect();
        fn section(r: &mut Read) -> Vec<f64> {
            let n = r.u();
            let out = r.v[r.at..r.at + n].to_vec();
            r.at += n;
            out
        }
        let templates = section(&mut r);
        let feedback = section(&mut r);
        let mut sample = section(&mut r);
        let ids = (0..r.u()).map(|_| r.u()).collect();
        let mapping = (0..r.u()).map(|_| r.f()).collect();
        let sparse = r.f() != 0.0;
        assert_eq!(r.at, v.len());
        // Install daily/profile metadata without advancing demand or the random stream.
        sample[9] = 0.0;
        crate::simulation::timed_sample_rows(&sample, sampling_state, None);
        sample[2] = 0.0;
        // An empty directory has no metadata tail; resize also supplies its
        // zero delta count rather than overwriting the last header field.
        sample.resize(14 + int(sample[12]) * 4, 0.0);
        *sample.last_mut().unwrap() = 0.0;
        let mut p = 7 + int(feedback[6]) * 2;
        p += 1 + int(feedback[p]) * 3;
        let nl = int(feedback[p]);
        p += 1;
        let mut line_offsets = vec![];
        for _ in 0..nl {
            line_offsets.push(p);
            p += 9 + int(feedback[p + 8]) + 10;
        }
        let run_offset = p;
        Self {
            sparse,
            token,
            catalog,
            motion,
            sampling,
            blocks,
            serial,
            next,
            fleet_minute,
            carry,
            remainder,
            rng,
            expected,
            feedback_minute,
            integer,
            transfer,
            runs,
            departures,
            templates,
            feedback,
            sample,
            ids,
            mapping,
            line_offsets,
            run_offset,
        }
    }
    fn refresh(&mut self, now: f64) -> Vec<f64> {
        if now.floor() == self.fleet_minute {
            return vec![];
        }
        self.fleet_minute = now.floor();
        let high = crate::temporal::peak(now);
        for run in &mut self.runs {
            if run.managed {
                run.fleet = if high { run.high } else { run.off };
            }
        }
        for d in &mut self.departures {
            let l = &self.runs[d.run];
            if !l.managed {
                continue;
            }
            let h = l.h();
            if d.present && h != d.h {
                d.next = if h.is_finite() {
                    crate::demand::max(now, crate::demand::min(d.next, d.last.unwrap_or(now) + h))
                } else {
                    f64::INFINITY
                };
                d.h = h;
            }
        }
        let mut out = vec![self.runs.len() as f64];
        out.extend(self.runs.iter().map(|l| l.fleet));
        out.push(self.departures.len() as f64);
        for d in &self.departures {
            out.extend_from_slice(&[d.next, d.h]);
        }
        out
    }
    fn feedback_frame(
        &self,
        now: f64,
        interval: f64,
        q: &crate::queues::Queues,
        order: &[usize],
    ) -> Vec<f64> {
        let trains = q.train_rows(order);
        let mut out = self.feedback[..self.run_offset].to_vec();
        out[2] = now;
        out[3] = interval;
        let mut active = std::collections::HashSet::new();
        for t in &trains {
            active.insert(t.2);
        }
        for d in &self.departures {
            let l = &self.runs[d.run];
            if d.last
                .is_some_and(|last| now - last <= 1.5 * if d.h != 0.0 { d.h } else { l.h0 })
            {
                active.insert(l.parent);
                active.extend(l.fares.iter().copied());
            }
        }
        for (i, &at) in self.line_offsets.iter().enumerate() {
            out[at + 2] = if active.contains(&self.ids[i]) {
                1.0
            } else {
                0.0
            };
            let enabled = self
                .runs
                .iter()
                .find(|l| l.parent == self.ids[i])
                .map_or(true, |l| {
                    !l.managed
                        || (if crate::temporal::peak(now) {
                            l.parent_high
                        } else {
                            l.parent_off
                        }) > 0.0
                });
            out[at + 3] = if enabled { 1.0 } else { 0.0 };
            let values = q.feedback_values(self.ids[i]);
            let start = at + 9 + int(out[at + 8]);
            out[start + 3..start + 7].copy_from_slice(&values);
        }
        out.push(self.runs.len() as f64);
        for l in &self.runs {
            out.extend_from_slice(&[l.base, l.h(), l.duration]);
        }
        out.push(trains.len() as f64);
        for t in trains {
            let base = self
                .ids
                .iter()
                .position(|&id| id == t.2)
                .unwrap_or(self.ids.len());
            out.extend_from_slice(&[base as f64, t.4, t.5]);
        }
        out
    }
    fn save_feedback(&mut self, prepared: &[f64], now: f64) {
        let nf = int(prepared[1]);
        if nf == 0 {
            return;
        }
        let f = &prepared[4..4 + nf];
        let mut p = 2;
        for &at in &self.line_offsets {
            let start = at + 9 + int(self.feedback[at + 8]);
            self.feedback[start..start + 7].copy_from_slice(&f[p..p + 7]);
            if f[p + 7] != 0.0 {
                self.feedback[start + 7] = f[p + 23];
                self.feedback[start + 8] = now;
                self.feedback[start + 9] = 0.0;
            }
            p += 8 + if f[p + 7] != 0.0 { 16 } else { 0 };
        }
    }
    fn dispatch_frame(&self, now: f64, q: &crate::queues::Queues, order: &[usize]) -> Vec<f64> {
        if !self
            .departures
            .iter()
            .any(|d| d.present && !(now + 1e-8 < d.next))
        {
            return vec![];
        }
        let trains = q.train_rows(order);
        let n = self
            .runs
            .iter()
            .map(|l| l.id.max(l.parent) + 1)
            .max()
            .unwrap_or(0);
        let mut out = vec![
            3.0,
            now,
            n as f64,
            n as f64,
            trains.len() as f64,
            self.departures.len() as f64,
        ];
        for t in trains {
            out.extend_from_slice(&[t.1 as f64, t.2 as f64, t.3 as f64]);
        }
        for d in &self.departures {
            let l = &self.runs[d.run];
            let high = crate::temporal::peak(now);
            out.extend_from_slice(&[
                l.id as f64,
                l.parent as f64,
                d.dir,
                if d.present { 1.0 } else { 0.0 },
                d.next,
                if d.h != 0.0 { d.h } else { l.h() },
                l.open,
                l.close,
                l.fleet,
                if l.managed { 1.0 } else { 0.0 },
                if high { l.parent_high } else { l.parent_off },
                if l.is_loop { 1.0 } else { 0.0 },
                l.dirs,
                l.duration,
                l.h(),
            ]);
        }
        out
    }
    fn template_frame(&self, dispatch: bool, now: f64) -> Vec<f64> {
        if !dispatch {
            return vec![0.0];
        }
        let mut out = self.templates.clone();
        let mut at = 1;
        for d in &self.departures {
            let l = &self.runs[d.run];
            let nq = int(out[at]);
            let nm = int(out[at + 1]);
            out[at + 2] = l.dwell();
            let m = at + 3 + nq;
            out[m + 1 + 11] = if l.opened(now) { 1.0 } else { 0.0 };
            out[m + 1 + 12] = l.fleet / l.dirs;
            out[m + 1 + 14] = l.dwell();
            at += 3 + nq + nm;
        }
        out
    }
}
#[no_mangle]
pub extern "C" fn calendar_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn engine_loop() -> *const f64 {
    CORE.with(|cell| {
        let mut c = cell.borrow_mut();
        let crate::Core {
            input,
            output,
            calendar_state,
            cycle_state,
            cycle_bytes,
            sampling_state,
            feedback_cache,
            simulation_state,
            queue_state,
            settlement_state,
            ..
        } = &mut *c;
        let nf = int(input[6]);
        let nm = int(input[7]);
        assert_eq!(input.len(), 8 + nf + nm);
        if nm > 0 {
            *calendar_state = Some(Calendar::read(&input[8 + nf..], sampling_state));
        }
        let cal = calendar_state.as_mut().expect("calendar missing");
        assert_eq!(cal.token, input[0]);
        let mut time = input[1];
        let mut remaining = input[2];
        let max = int(input[3]);
        let budget = input[4];
        let barrier = input[5];
        let mut fin = input[8..8 + nf].to_vec();
        let start = crate::engine::monotonic();
        let mut steps = 0;
        let mut reason = 0.0;
        let mut chunks = vec![];
        while remaining >= 0.1 && steps < max {
            if time + 0.1 >= barrier - 1e-8 {
                reason = 1.0;
                break;
            }
            let bank = settlement_state.as_ref().expect("bank missing");
            if bank.economy[8] != 0.0 {
                reason = 2.0;
                break;
            }
            if crate::operations::next(time, 0.1, &bank.loans) != 0.1 {
                reason = 1.0;
                break;
            }
            let next = time + 0.1;
            // Day archiving can precede the next sampling gate. Let the host
            // reload its new statistics day before any native state is changed.
            if queue_state.as_mut().unwrap().finance_stats()
                .map_or(false, |stats| !stats.can_advance_slot(next)) {
                reason = 1.0;
                break;
            }
            let (carry, interval) = crate::operations::generation(cal.carry, 0.1);
            let view = cal.refresh(next);
            let (motion, order) = crate::simulation::continuation(simulation_state, next);
            let q = queue_state.as_mut().expect("queue missing");
            if let Some(stats) = q.finance_stats() {
                stats.advance_slot(next);
            }
            let params = if view.is_empty() {
                vec![]
            } else {
                q.train_rows(&order)
                    .iter()
                    .filter_map(|t| {
                        cal.runs.iter().find(|l| l.id == t.1).map(|l| {
                            (
                                t.0,
                                if l.opened(next) { 1.0 } else { 0.0 },
                                l.fleet / l.dirs,
                                l.dwell(),
                            )
                        })
                    })
                    .collect::<Vec<_>>()
            };
            crate::simulation::calendar_params(simulation_state, cal.blocks, &params);
            // Rebuild a motion packet after reserving block IDs introduced by future templates.
            let (motion, order) = if motion[5] as usize != cal.blocks {
                crate::simulation::continuation(simulation_state, next)
            } else {
                (motion, order)
            };
            let feedback = if interval != 0.0 {
                q.prune_hour(next);
                cal.feedback_frame(next, interval, q, &order)
            } else {
                vec![]
            };
            let mut sample = if interval != 0.0 {
                cal.sample.clone()
            } else {
                vec![]
            };
            if !sample.is_empty() {
                sample[6] = cal.remainder;
                sample[7] = cal.rng;
                sample[8] = (next * 1e6).round() / 1e6;
                sample[9] = interval;
            }
            let dispatch = cal.dispatch_frame(next, q, &order);
            let templates = cal.template_frame(!dispatch.is_empty(), next);
            let mut prep = vec![
                1.0,
                feedback.len() as f64,
                sample.len() as f64,
                dispatch.len() as f64,
                if sample.is_empty() {
                    0.0
                } else {
                    cal.mapping.len() as f64
                },
            ];
            if !sample.is_empty() {
                prep.extend_from_slice(&cal.mapping);
            }
            prep.extend(&feedback);
            prep.extend(&sample);
            prep.extend(&dispatch);
            let rules = if sample.is_empty() {
                vec![0.0]
            } else {
                let mut rules = vec![cal.runs.len() as f64];
                for l in &cal.runs {
                    rules.extend_from_slice(&[
                        l.id as f64,
                        l.open,
                        l.close,
                        if l.managed { 1.0 } else { 0.0 },
                        l.fleet,
                    ]);
                }
                rules
            };
            fin.truncate(16);
            fin[2] = 0.0;
            fin[3] = next;
            fin[4] = 0.1;
            fin[5] = 0.1;
            fin[6] = carry;
            fin[7] = q.counter(6);
            fin[8] = q.counter(7);
            let mut parents = std::collections::HashSet::new();
            fin[11] = cal
                .runs
                .iter()
                .filter(|l| parents.insert(l.parent))
                .map(|l| {
                    if crate::temporal::peak(next) {
                        l.parent_high
                    } else {
                        l.parent_off
                    }
                })
                .sum();
            let header = vec![
                if cal.sparse { 3.0 } else { 2.0 },
                cal.token,
                0.0,
                0.0,
                next,
                1.0,
                if cal.integer { 1.0 } else { 0.0 },
                cal.transfer,
                if cal.integer && interval != 0.0 {
                    1.0
                } else {
                    0.0
                },
                0.0,
                -1.0,
                -1.0,
                0.0,
                motion.len() as f64,
            ];
            let mut tail = vec![order.len() as f64];
            tail.extend(order.iter().map(|&id| id as f64));
            tail.extend_from_slice(&[0.0, 0.0]);
            let ids = if feedback.is_empty() {
                vec![]
            } else {
                cal.ids.iter().map(|&id| id as f64).collect::<Vec<_>>()
            };
            let statistics = vec![0.0, 0.0];
            let zero = vec![0.0];
            let parts: [&[f64]; 8] = [
                &header,
                &motion,
                &zero,
                &zero,
                &zero,
                &[],
                &tail,
                &statistics,
            ];
            let mut packet = vec![
                1.0,
                cal.token,
                cal.catalog,
                cycle_state.as_ref().unwrap().count() as f64,
                cal.serial as f64,
                cal.next as f64,
                0.0,
                0.0,
                0.0,
                ids.len() as f64,
                prep.len() as f64,
                fin.len() as f64,
                templates.len() as f64,
                rules.len() as f64,
                cal.motion,
                cal.sampling,
                fin[1],
            ];
            packet.extend(parts.iter().map(|p| p.len() as f64));
            packet.extend(ids);
            packet.extend(templates);
            packet.extend(rules);
            packet.extend(prep);
            packet.extend(&fin);
            for p in parts {
                packet.extend(p);
            }
            let result = crate::cycle::run(
                &packet,
                cycle_bytes,
                cycle_state,
                sampling_state,
                feedback_cache,
                simulation_state,
                queue_state,
                settlement_state,
            );
            if result[1] != 0.0 {
                reason = 5.0;
                break;
            }
            let p = 11 + int(result[3]) + int(result[4]) * 2 + int(result[5]) * 3;
            let prepared = &result[p..p + int(result[8])];
            cal.save_feedback(prepared, next);
            let ns = int(prepared[2]);
            let nd = int(prepared[3]);
            let sp = 4 + int(prepared[1]);
            if ns > 0 {
                cal.feedback_minute = next;
                cal.expected += prepared[sp];
                cal.remainder = prepared[sp + 1];
                cal.rng = prepared[sp + 2];
            }
            if nd > 0 {
                let d = &prepared[sp + ns..];
                for (i, dep) in cal.departures.iter_mut().enumerate() {
                    if d[i * 2] < 0.0 {
                        continue;
                    }
                    if d[i * 2] == 1.0 {
                        dep.last = Some(next);
                    }
                    dep.next = d[i * 2 + 1];
                }
            }
            cal.serial = int(result[6]);
            cal.next = int(result[7]);
            cal.carry = carry;
            time = next;
            remaining -= 0.1;
            steps += 1;
            chunks.extend_from_slice(&[
                time,
                carry,
                interval,
                if view.is_empty() { 0.0 } else { 1.0 },
                view.len() as f64,
                result.len() as f64,
            ]);
            chunks.extend(view);
            chunks.extend_from_slice(&result);
            let qp = p + int(result[8]);
            if result[qp + 1] != 0.0 {
                reason = 3.0;
                break;
            }
            let account = &result[qp + int(result[9])..];
            fin[15] = crate::engine::day_operating(account, fin[15]);
            if account[16] != 0.0 {
                reason = 2.0;
                break;
            }
            if crate::engine::monotonic() - start >= budget {
                reason = 4.0;
                break;
            }
        }
        let view = if cal.sparse && steps > 0 {
            queue_state.as_ref().unwrap().view()
        } else {
            vec![]
        };
        *output = vec![1.0, steps as f64, remaining, reason, view.len() as f64];
        output.extend(chunks);
        output.extend(view);
        output.as_ptr()
    })
}

#[cfg(test)]
mod tests {
    fn run() -> super::Run {
        super::Run {
            id: 0,
            parent: 0,
            base: 0.0,
            duration: 5.5,
            h0: 12.0,
            is_loop: true,
            dirs: 1.0,
            calls: 4.0,
            open: 360.0,
            close: 1380.0,
            managed: true,
            off: 4.0,
            high: 8.0,
            parent_off: 4.0,
            parent_high: 8.0,
            fleet: 8.0,
            fares: vec![],
        }
    }
    #[test]
    fn loop_alignment_and_minimum_headway() {
        let l = run();
        assert_eq!(l.h(), 2.0);
        assert_eq!(l.dwell(), 0.725);
    }
    #[test]
    fn stock_and_opening_edges() {
        let mut l = run();
        l.fleet = 0.0;
        assert_eq!(l.h(), f64::INFINITY);
        assert!(!l.opened(359.999));
        assert!(l.opened(360.0));
        assert!(!l.opened(1380.0));
        l.is_loop = false;
        l.fleet = 4.0;
        assert_eq!(l.h(), 3.25);
        assert_eq!(l.dwell(), 0.6);
    }
}
