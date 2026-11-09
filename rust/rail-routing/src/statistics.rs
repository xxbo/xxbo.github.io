//! Actual operating statistics, updated in event order and projected once per touched field.
use crate::demand::max;
use crate::numbers::Map;
use crate::queues::Read;
use crate::CORE;

const LINE_FIELDS: usize = 9;
struct Row<const N: usize> {
    values: [f64; N],
    present: u32,
    dirty: u32,
    order: Vec<usize>,
}
impl<const N: usize> Row<N> {
    fn missing() -> Self {
        Self {
            values: [f64::NAN; N],
            present: 0,
            dirty: 0,
            order: vec![],
        }
    }
    fn line() -> Self {
        let mut row = Self::missing();
        for k in 0..5 {
            row.values[k] = 0.0;
            row.present |= 1 << k;
            row.order.push(k);
        }
        row
    }
    fn station() -> Self {
        let mut row = Self::missing();
        for k in 0..3 {
            row.values[k] = 0.0;
            row.present |= 1 << k;
            row.order.push(k);
        }
        row
    }
    fn read(r: &mut Read) -> Self {
        let mut row = Self::missing();
        let n = r.u();
        for _ in 0..n {
            let k = r.u();
            assert!(k < N);
            row.values[k] = r.f();
            row.present |= 1 << k;
            row.order.push(k);
        }
        row
    }
    fn set(&mut self, k: usize, value: f64) {
        if self.present & (1 << k) != 0 && self.values[k].to_bits() == value.to_bits() {
            return;
        }
        if self.present & (1 << k) == 0 {
            self.order.push(k);
            self.present |= 1 << k;
        }
        self.values[k] = value;
        self.dirty |= 1 << k;
    }
    fn add(&mut self, k: usize, n: f64) {
        self.set(k, self.values[k] + n);
    }
    fn add_zero(&mut self, k: usize, n: f64) {
        self.set(k, or_zero(self.values[k]) + n);
    }
}
fn or_zero(n: f64) -> f64 {
    if n.is_nan() || n == 0.0 {
        0.0
    } else {
        n
    }
}
fn cmd(out: &mut Vec<f64>, op: f64, args: &[f64]) {
    out.push(op);
    out.extend_from_slice(args);
    for _ in args.len()..7 {
        out.push(0.0);
    }
}

// Three ordered field assignments fit one fixed-width projection row.
fn fields(out: &mut Vec<f64>, op: f64, id: f64, values: impl Iterator<Item = (usize, f64)>) {
    let empty = [op, id, -1.0, 0.0, -1.0, 0.0, -1.0, 0.0];
    let mut row = empty;
    let mut count = 0;
    for (key, value) in values {
        row[2 + count * 2] = key as f64;
        row[3 + count * 2] = value;
        count += 1;
        if count == 3 {
            out.extend(row);
            row = empty;
            count = 0;
        }
    }
    if count > 0 {
        out.extend(row);
    }
}

pub(super) struct Statistics {
    now: f64,
    day: f64,
    factor: f64,
    slot: f64,
    network: [f64; 7],
    network_dirty: u32,
    records: [f64; 6],
    record_dirty: u32,
    flow: [f64; 3],
    flow_dirty: u32,
    hour: Vec<(f64, f64)>,
    hour_dirty: bool,
    hour_append: bool,
    hour_remove: Vec<usize>,
    lines: Map<usize, Row<LINE_FIELDS>>,
    feedback: Map<usize, Row<5>>,
    stations: Map<usize, Row<3>>,
    dirty_lines: Vec<usize>,
    dirty_feedback: Vec<usize>,
    dirty_stations: Vec<usize>,
    touched: bool,
}
impl Statistics {
    pub(super) fn read(r: &mut Read, now: f64) -> Self {
        let day = r.f();
        let factor = r.f();
        let slot = r.f();
        let mut network = [0.0; 7];
        for v in &mut network {
            *v = r.f();
        }
        let mut records = [0.0; 6];
        for v in &mut records {
            *v = r.f();
        }
        let mut flow = [0.0; 3];
        for v in &mut flow {
            *v = r.f();
        }
        let n = r.u();
        let hour = (0..n).map(|_| (r.f(), r.f())).collect();
        let n = r.u();
        let mut lines = Map::default();
        for _ in 0..n {
            let id = r.u();
            lines.insert(id, Row::read(r));
        }
        let n = r.u();
        let mut feedback = Map::default();
        for _ in 0..n {
            let id = r.u();
            feedback.insert(id, Row::read(r));
        }
        let n = r.u();
        let mut stations = Map::default();
        for _ in 0..n {
            let id = r.u();
            stations.insert(id, Row::read(r));
        }
        Self {
            now,
            day,
            factor,
            slot,
            network,
            network_dirty: 0,
            records,
            record_dirty: 0,
            flow,
            flow_dirty: 0,
            hour,
            hour_dirty: false,
            hour_append: false,
            hour_remove: vec![],
            lines,
            feedback,
            stations,
            dirty_lines: vec![],
            dirty_feedback: vec![],
            dirty_stations: vec![],
            touched: false,
        }
    }
    pub(super) fn feedback_values(&self, id: usize) -> [f64; 4] {
        self.feedback
            .get(&id)
            .map_or([0.0; 4], |r| r.values[..4].try_into().unwrap())
    }
    pub(super) fn prune_hour(&mut self, now: f64) {
        self.hour.retain(|&(minute, _)| minute > now.floor() - 60.0);
    }
    // A forward calendar step enters a fresh, empty slot. The preceding slot's
    // assignments have already been emitted by finish(); keep all day totals,
    // records and ordered line/station rows in place instead of reloading them.
    pub(super) fn can_advance_slot(&self, now: f64) -> bool {
        let start = 420.0 + (self.day - 1.0) * 1440.0;
        let slot = ((now - start) / 15.0).floor();
        slot >= 0.0 && slot < 96.0 && slot >= self.slot
            && (slot == self.slot || self.flow_dirty == 0)
    }
    pub(super) fn advance_slot(&mut self, now: f64) {
        let start = 420.0 + (self.day - 1.0) * 1440.0;
        let slot = ((now - start) / 15.0).floor();
        assert!(slot >= 0.0 && slot < 96.0, "day rollover requires host archive");
        if slot != self.slot {
            assert!(slot > self.slot, "calendar must advance monotonically");
            assert_eq!(self.flow_dirty, 0, "flush the previous slot first");
            self.slot = slot;
            self.flow = [0.0; 3];
        }
    }
    pub(super) fn operating(&self, id: usize) -> f64 {
        self.lines.get(&id).map_or(f64::NAN, |row| row.values[8])
    }
    pub(super) fn set_operating(&mut self, id: usize, value: f64) {
        let row = self.lines.entry(id).or_insert_with(Row::line);
        let dirty = row.dirty;
        row.set(8, value);
        row.dirty = dirty;
    }
    pub(super) fn set_feedback(&mut self, id: usize, values: &[f64]) {
        if let Some(row) = self.feedback.get_mut(&id) {
            let dirty = row.dirty;
            for i in 0..4 {
                row.set(i, values[i]);
            }
            row.dirty = dirty;
        }
    }
    pub(super) fn frame(&mut self, r: &mut Read, now: f64) {
        self.now = now;
        let n = r.u();
        for _ in 0..n {
            let id = r.u();
            let value = r.f();
            let row = self.lines.entry(id).or_insert_with(Row::line);
            // Finance has already projected this assignment in JS; it is an input, not a new event.
            let dirty = row.dirty;
            row.set(8, value);
            row.dirty = dirty;
        }
    }
    fn line(&mut self, id: usize) -> &mut Row<LINE_FIELDS> {
        let row = self.lines.entry(id).or_insert_with(Row::line);
        if row.dirty == 0 {
            self.dirty_lines.push(id);
        }
        row
    }
    fn feedback(&mut self, id: usize) -> Option<&mut Row<5>> {
        let row = self.feedback.get_mut(&id)?;
        if row.dirty == 0 {
            self.dirty_feedback.push(id);
        }
        Some(row)
    }
    fn station(&mut self, id: usize) -> &mut Row<3> {
        let row = self.stations.entry(id).or_insert_with(Row::station);
        if row.dirty == 0 {
            self.dirty_stations.push(id);
        }
        row
    }
    fn inc(&mut self, k: usize, n: f64) {
        let value = self.network[k] + n;
        if value.is_finite() && value.to_bits() == self.network[k].to_bits() {
            return;
        }
        self.network[k] = value;
        self.network_dirty |= 1 << k;
    }
    fn inc_zero(&mut self, k: usize, n: f64) {
        let value = or_zero(self.network[k]) + n;
        if value.is_finite() && value.to_bits() == self.network[k].to_bits() {
            return;
        }
        self.network[k] = value;
        self.network_dirty |= 1 << k;
    }
    fn record(&mut self, k: usize, n: f64) {
        if n.is_finite() && n.to_bits() == self.records[k].to_bits() {
            return;
        }
        self.records[k] = n;
        self.record_dirty |= 1 << k;
    }
    pub(super) fn event(
        &mut self,
        kind: usize,
        ids: &[usize],
        fare: f64,
        shares: &[(usize, u64)],
        n: f64,
        wait: f64,
        line: Option<usize>,
        station: Option<usize>,
    ) {
        if n == 0.0 {
            return;
        }
        self.touched = true;
        let flow = match kind {
            1 => Some(0),
            2 => Some(1),
            5 => Some(2),
            _ => None,
        };
        if self.slot >= 0.0 && n.is_finite() && n > 0.0 {
            if let Some(k) = flow {
                self.flow[k] += n;
                self.flow_dirty |= 1 << k;
            }
        }
        if let Some(id) = station {
            let k = match kind {
                1 => Some(0),
                2 => Some(1),
                3 => Some(2),
                _ => None,
            };
            if let Some(k) = k {
                self.station(id).add(k, n);
            }
        }
        match kind {
            0 => {
                self.inc(0, n);
                for &id in ids {
                    self.line(id).add(0, n);
                    if let Some(r) = self.feedback(id) {
                        r.add(0, n);
                    }
                }
            }
            4 => {
                self.inc(2, n);
                for &id in ids {
                    self.line(id).add(2, n);
                    if let Some(r) = self.feedback(id) {
                        r.add(1, n);
                    }
                }
            }
            2 => {
                self.inc(3, n);
                self.inc(4, wait * n);
                if let Some(id) = line {
                    let r = self.line(id);
                    r.add(3, n);
                    r.add(4, wait * n);
                    if let Some(r) = self.feedback(id) {
                        r.add(3, n);
                        r.add(2, wait * n);
                    }
                }
            }
            5 => {
                let revenue = n * or_zero(fare);
                self.inc_zero(5, revenue);
                for &(id, share) in shares {
                    self.line(id).add_zero(5, revenue * f64::from_bits(share));
                }
                self.inc(1, n);
                self.record(0, self.records[0] + n);
                for &id in ids {
                    let r = self.line(id);
                    r.add(1, n);
                    let completed = r.values[1];
                    if let Some(r) = self.feedback(id) {
                        r.set(4, max(r.values[4], completed));
                    }
                }
                let minute = (self.now + 1e-7).floor();
                if !self.hour_dirty {
                    self.hour_remove = self
                        .hour
                        .iter()
                        .enumerate()
                        .filter_map(|(i, &(m, _))| if m > minute - 60.0 { None } else { Some(i) })
                        .collect();
                    self.hour.retain(|&(m, _)| m > minute - 60.0);
                    self.hour_append = !self.hour.last().map_or(false, |&(m, _)| m == minute);
                }
                if self.hour.last().map_or(false, |&(m, _)| m == minute) {
                    self.hour.last_mut().unwrap().1 += n;
                } else {
                    self.hour.push((minute, n));
                }
                self.hour_dirty = true;
                let total = self.hour.iter().fold(0.0, |a, x| a + x.1);
                if total > self.records[4] {
                    self.record(4, total);
                    self.record(5, minute);
                }
                if self.network[1] > self.records[2] {
                    self.record(2, self.network[1]);
                    self.record(3, self.day);
                }
            }
            _ => {}
        }
    }
    pub(super) fn travel(&mut self, id: usize, km: f64, onboard: f64, cars: f64) {
        if km <= 0.0 {
            return;
        }
        self.touched = true;
        let pkm = km * onboard;
        self.inc_zero(6, pkm);
        let factor = self.factor;
        let r = self.line(id);
        r.add_zero(6, pkm);
        r.add_zero(7, km);
        r.add_zero(8, km * (180.0 + or_cars(cars) * 25.0) * factor);
        self.record(1, or_zero(self.records[1]) + pkm);
    }
    pub(super) fn finish(&mut self) -> Vec<f64> {
        let mut out = vec![];
        if self.touched {
            cmd(&mut out, 40.0, &[]);
        }
        fields(
            &mut out,
            32.0,
            0.0,
            (0..7)
                .filter(|&k| self.network_dirty & (1 << k) != 0)
                .map(|k| (k, self.network[k])),
        );
        fields(
            &mut out,
            33.0,
            0.0,
            (0..6)
                .filter(|&k| self.record_dirty & (1 << k) != 0)
                .map(|k| (k, self.records[k])),
        );
        for &id in &self.dirty_lines {
            let r = self.lines.get_mut(&id).unwrap();
            fields(
                &mut out,
                34.0,
                id as f64,
                r.order
                    .iter()
                    .copied()
                    .filter(|&k| r.dirty & (1 << k) != 0)
                    .map(|k| (k, r.values[k])),
            );
            r.dirty = 0;
        }
        for &id in &self.dirty_feedback {
            let r = self.feedback.get_mut(&id).unwrap();
            fields(
                &mut out,
                35.0,
                id as f64,
                r.order
                    .iter()
                    .copied()
                    .filter(|&k| r.dirty & (1 << k) != 0)
                    .map(|k| (k, r.values[k])),
            );
            r.dirty = 0;
        }
        for &id in &self.dirty_stations {
            let r = self.stations.get_mut(&id).unwrap();
            fields(
                &mut out,
                36.0,
                id as f64,
                r.order
                    .iter()
                    .copied()
                    .filter(|&k| r.dirty & (1 << k) != 0)
                    .map(|k| (k, r.values[k])),
            );
            r.dirty = 0;
        }
        fields(
            &mut out,
            37.0,
            self.slot,
            (0..3)
                .filter(|&k| self.flow_dirty & (1 << k) != 0)
                .map(|k| (k, self.flow[k])),
        );
        if self.hour_dirty {
            for &i in &self.hour_remove {
                cmd(&mut out, 39.0, &[i as f64]);
            }
            let &(minute, count) = self.hour.last().unwrap();
            cmd(
                &mut out,
                38.0,
                &[if self.hour_append { 1.0 } else { 0.0 }, minute, count],
            );
        }
        self.hour_remove.clear();
        self.network_dirty = 0;
        self.record_dirty = 0;
        self.flow_dirty = 0;
        self.hour_dirty = false;
        self.touched = false;
        self.dirty_lines.clear();
        self.dirty_feedback.clear();
        self.dirty_stations.clear();
        out
    }
}
fn or_cars(n: f64) -> f64 {
    if n.is_nan() || n == 0.0 {
        6.0
    } else {
        n
    }
}
#[no_mangle]
pub extern "C" fn statistics_abi() -> u32 {
    1
}
#[no_mangle]
pub extern "C" fn statistics_run() -> *const f64 {
    CORE.with(|c| {
        let mut c = c.borrow_mut();
        let crate::Core { input, output, .. } = &mut *c;
        let mut r = Read { v: input, at: 0 };
        assert_eq!(r.f(), 1.0);
        let kind = r.u();
        let now = r.f();
        let mut stats = Statistics::read(&mut r, now);
        if kind == 0 {
            let event = r.u();
            let n = r.f();
            let wait = r.f();
            let line = r.f();
            let station = r.f();
            let fare = r.f();
            let nids = r.u();
            let ids = (0..nids).map(|_| r.u()).collect::<Vec<_>>();
            let nb = r.u();
            let shares = (0..nb)
                .map(|_| (r.u(), r.f().to_bits()))
                .collect::<Vec<_>>();
            stats.event(
                event,
                &ids,
                fare,
                &shares,
                n,
                wait,
                if line < 0.0 {
                    None
                } else {
                    Some(line as usize)
                },
                if station < 0.0 {
                    None
                } else {
                    Some(station as usize)
                },
            );
        } else if kind == 2 {
            let n = r.u();
            for _ in 0..n {
                let count = r.f();
                let ni = r.u();
                let ids = (0..ni).map(|_| r.u()).collect::<Vec<_>>();
                stats.event(4, &ids, 0.0, &[], count, 0.0, None, None);
            }
        } else {
            assert_eq!(kind, 1);
            let id = r.u();
            let km = r.f();
            let n = r.f();
            let cars = r.f();
            stats.travel(id, km, n, cars);
        }
        assert_eq!(r.at, input.len());
        *output = stats.finish();
        output.as_ptr()
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Statistics {
        let mut input = vec![1.0, 0.05, 0.0];
        input.extend([7.0; 7]);
        input.extend([9.0; 6]);
        input.extend([3.0; 3]);
        input.extend([0.0; 4]); // hour, lines, feedback, stations
        Statistics::read(&mut Read { v: &input, at: 0 }, 420.0)
    }
    #[test]
    fn slot_rollover_preserves_totals_and_resets_only_flow() {
        let mut s = sample();
        s.advance_slot(434.999999);
        assert_eq!(s.flow, [3.0; 3]);
        s.advance_slot(435.0);
        assert_eq!(s.slot, 1.0);
        assert_eq!(s.flow, [0.0; 3]);
        assert_eq!(s.network, [7.0; 7]);
        assert_eq!(s.records, [9.0; 6]);
        s.now = 435.0;
        s.event(1, &[], 0.0, &[], 2.0, 0.0, None, None);
        let out = s.finish();
        assert!(out.chunks_exact(8).any(|r| r[..4] == [37.0, 1.0, 0.0, 2.0]));
        s.advance_slot(450.0);
        assert_eq!(s.flow, [0.0; 3]);
    }
    #[test]
    #[should_panic(expected = "day rollover requires host archive")]
    fn slot_rollover_keeps_day_archive_barrier() {
        sample().advance_slot(1860.0);
    }
    #[test]
    fn row_preserves_first_field_order_and_js_missing_values() {
        let mut r = Row::<9>::line();
        r.add_zero(6, 2.0);
        r.add_zero(8, 3.0);
        r.add_zero(5, 4.0);
        assert_eq!(r.order, vec![0, 1, 2, 3, 4, 6, 8, 5]);
        let mut missing = Row::<9>::missing();
        missing.add(0, 1.0);
        assert!(missing.values[0].is_nan());
    }
}
