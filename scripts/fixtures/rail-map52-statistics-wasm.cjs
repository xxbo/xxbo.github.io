/* Statistics transport and view projection. Event arithmetic and record decisions live in Rust. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./rail-map52-routing-wasm.cjs') : root.RailRouting;
  const BAL = node ? require('../../rail/game-balance') : root.RailBalance;
  const FLOW = node ? require('../../rail/flow-history') : root.RailFlowHistory;
  const NETWORK = ['attempted', 'completed', 'rejected', 'boarded', 'waitMinutes', 'revenue',
    'passengerKm'
  ];
  const RECORDS = ['totalCompleted', 'totalPassengerKm', 'bestDay', 'bestDayNumber', 'bestHour',
    'bestHourMinute'
  ];
  const LINES = ['attempted', 'completed', 'rejected', 'boarded', 'waitMinutes', 'revenue',
    'passengerKm', 'vehicleKm', 'operating'
  ];
  const FEEDBACK = ['attempted', 'lost', 'wait', 'boarded', 'bestDay'];
  const STATIONS = ['entered', 'boarded', 'alighted'];
  const KINDS = ['attempt', 'enter', 'board', 'alight', 'reject', 'complete'];
  const intern = (c, id) => {
    if (!c.ids.has(id)) {
      c.ids.set(id, c.names.length);
      c.names.push(id);
    }
    return c.ids.get(id);
  };

  function rows(out, values, fields, id) {
    const entries = Object.entries(values || {});
    out.push(entries.length);
    for (const [name, value] of entries) {
      const keys = Object.keys(value).filter(k => fields.includes(k));
      out.push(id(name), keys.length);
      for (const k of keys) out.push(fields.indexOf(k), Number(value[k]));
    }
  }

  function bind(hooks) {
    const revisions = new WeakMap();
    const state = q => {
      let v = revisions.get(q);
      if (!v) {
        v = {
          revision: 0,
          finance: new Map()
        };
        revisions.set(q, v);
      }
      return v;
    };

    function invalidate(s) {
      if (s.ridership) state(s.ridership).revision++;
    }

    function financeChanged(s, id, value) {
      if (s.ridership) state(s.ridership).finance.set(id, value);
    }

    function context(c, s, rt) {
      const q = s.ridership,
        number = hooks.day(rt.minute);
      const d = q.current.number === number ? q.current : {
        number,
        attempted: 0,
        completed: 0,
        rejected: 0,
        boarded: 0,
        waitMinutes: 0,
        revenue: 0,
        passengerKm: 0,
        lines: {},
        stations: {}
      };
      const start = 420 + (number - 1) * 1440,
        index = Math.floor((rt.minute - start) / FLOW.STEP);
      const slot = rt.minute >= start && rt.minute <= start + 1440 && index >= 0 && index < FLOW
        .SLOTS ? index : -1;
      const valid = d.flow?.version === 1 && FLOW.FIELDS.every(k => Array.isArray(d.flow[k]) && d
        .flow[k].length === FLOW.SLOTS);
      const out = [number, BAL.OPERATING_FACTOR, slot];
      for (const k of NETWORK) out.push(Number(d[k]));
      for (const k of RECORDS) out.push(Number(q.records[k]));
      for (const k of FLOW.FIELDS) out.push(valid && slot >= 0 ? Number(d.flow[k][slot]) : 0);
      out.push(q.hour.length);
      for (const row of q.hour) out.push(row.minute, row.count);
      rows(out, d.lines, LINES, id => intern(c, id));
      rows(out, q.lines, FEEDBACK, id => intern(c, id));
      rows(out, d.stations, STATIONS, Number);
      return out;
    }

    function frame(c, s, rt, full) {
      const q = s.ridership;
      if (!q) {
        c.statsContext = null;
        return [-1];
      }
      const v = state(q),
        number = hooks.day(rt.minute),
        slot = Math.floor((rt.minute - 420 - (number - 1) * 1440) / FLOW.STEP);
      const previous = c.statsContext;
      const reset = full || !previous || previous.q !== q || previous.day !== q.current ||
        previous.records !== q.records || previous.lines !== q.lines || previous.flow !== q
        .current.flow ||
        previous.revision !== v.revision || previous.number !== number || previous.slot !== slot;
      let out;
      if (reset) {
        out = [1, ...context(c, s, rt)];
        c.statsContext = {
          q,
          day: q.current,
          records: q.records,
          lines: q.lines,
          flow: q.current.flow,
          revision: v.revision,
          number,
          slot
        };
      } else {
        out = [0, v.finance.size];
        for (const [id, value] of v.finance) out.push(intern(c, id), value);
      }
      v.finance.clear();
      return out;
    }

    function projector(c, s, rt) {
      const q = s.ridership;
      let d = null;
      const hourDeletes = [];
      const current = () => d || (d = hooks.ensureDay(s, rt.minute));
      return (data, at) => {
        const op = data[at],
          a = data[at + 1],
          b = data[at + 2],
          value = data[at + 3];
        switch (op) {
          case 40:
            current();
            break;
          case 32:
          case 33:
          case 34:
          case 35:
          case 36:
          case 37: {
            let target, fields;
            if (op === 32) {
              target = current();
              fields = NETWORK;
            } else if (op === 33) {
              target = q.records;
              fields = RECORDS;
            } else if (op === 34) {
              target = hooks.lineStats(current(), c.names[a]);
              fields = LINES;
            } else if (op === 35) {
              target = q.lines[c.names[a]];
              fields = FEEDBACK;
            } else if (op === 36) {
              const day = current();
              day.stations = day.stations || {};
              target = day.stations[a] || (day.stations[a] = {
                entered: 0,
                boarded: 0,
                alighted: 0
              });
              fields = STATIONS;
            } else {
              target = current().flow;
              fields = FLOW.FIELDS;
            }
            for (let pair = 2; pair < 8; pair += 2) {
              const field = data[at + pair];
              if (field < 0) break;
              if (op === 37) target[fields[field]][a] = data[at + pair + 1];
              else target[fields[field]] = data[at + pair + 1];
            }
            break;
          }
          case 39:
            hourDeletes.push(a);
            break;
          case 38: {
            let deleted = 0;
            q.hour = q.hour.filter((row, i) => {
              if (i === hourDeletes[deleted]) {
                deleted++;
                return false;
              }
              return true;
            });
            hourDeletes.length = 0;
            if (a) q.hour.push({
              minute: b,
              count: value
            });
            else q.hour.at(-1).count = value;
            break;
          }
          default:
            throw Error('未知原生统计操作 ' + op);
        }
      };
    }

    function event(s, rt, j, kind, count, wait = 0, line = null, station = null) {
      if (!s.ridership || !count) return;
      const c = {
        ids: new Map(),
        names: []
      };
      const head = context(c, s, rt),
        ids = j.lineIds || [],
        shares = Object.entries(j.byLine || {});
      const tail = [Math.max(0, KINDS.indexOf(kind)) === KINDS.indexOf(kind) ? KINDS.indexOf(
          kind) : 6,
        count, wait, line ? intern(c, line) : -1, station === null ? -1 : station, j.fare || 0,
        ids.length, ...ids.map(id => intern(c, id)), shares.length
      ];
      for (const [id, share] of shares) tail.push(intern(c, id), share);
      const out = Core.kernel('statistics_run', new Float64Array([1, 0, rt.minute, ...head, ...
        tail
      ]));
      hooks.ensureDay(s, rt.minute);
      const apply = projector(c, s, rt);
      for (let at = 0; at < out.length; at += 8) apply(out, at);
      invalidate(s);
    }

    function rejectBatch(s, rt, events) {
      if (!s.ridership || !events.length) return;
      const c = {
          ids: new Map(),
          names: []
        },
        head = context(c, s, rt),
        tail = [events.length];
      for (const {
          journey,
          count
        }
        of events) {
        const ids = journey.lineIds || [];
        tail.push(count, ids.length, ...ids.map(id => intern(c, id)));
      }
      // Structural edits already have a complete JS recovery snapshot; release a previous large arena.
      if (Core.status().memoryBytes > 64 * 1024 * 1024) Core.recycleSimulation();
      const input = new Float64Array(3 + head.length + tail.length);
      input.set([1, 2, rt.minute]);
      input.set(head, 3);
      input.set(tail, 3 + head.length);
      const out = Core.kernel('statistics_run', input),
        apply = projector(c, s, rt);
      for (let at = 0; at < out.length; at += 8) apply(out, at);
      invalidate(s);
    }

    function travel(s, rt, t, km, vehicle = null, occupancy = t.onboard) {
      if (!s.ridership || km <= 0) return;
      const c = {
          ids: new Map(),
          names: []
        },
        head = context(c, s, rt);
      const run = vehicle || t.retiringRun || rt.plan.services.find(l => l.id === t.service);
      const tail = [intern(c, t.parentLine || t.service), km, occupancy, run?.cars || 6];
      const out = Core.kernel('statistics_run', new Float64Array([1, 1, rt.minute, ...head, ...
        tail
      ]));
      const apply = projector(c, s, rt);
      for (let at = 0; at < out.length; at += 8) apply(out, at);
      invalidate(s);
    }
    return {
      rejectBatch,
      frame,
      projector,
      event,
      travel,
      invalidate,
      financeChanged
    };
  }
  const api = {
    bind
  };
  if (node) module.exports = api;
  else root.RailStatistics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
