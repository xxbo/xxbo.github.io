/* Persistent native queues. JS restores identities and projects ordered events into existing views. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./rail-map50-routing-wasm.cjs') : root.RailRouting;
  const Engine = node ? require('./rail-map50-engine-wasm.cjs') : root.RailNativeEngine;
  const SIM = node ? require('./rail-map50-simulation-wasm.cjs') : root.RailSimulation;
  const Q = node ? require('./rail-map50-ridership.cjs') : root.RailRidership;
  const X = node ? require('./rail-map50-service-plan.cjs') : root.RailServicePlan;
  const counters = ['generated', 'boarded', 'alighted', 'completed', 'cancelled', 'rejected',
    'revenue', 'vehicleExpense'
  ];
  const kinds = ['attempt', 'enter', 'board', 'alight', 'reject', 'complete'];
  const states = new WeakMap(),
    identities = new WeakMap();
  let serial = 0,
    trainSerial = 0;
  const uid = t => {
    if (!identities.has(t)) identities.set(t, ++trainSerial);
    return identities.get(t);
  };
  const intern = (m, names, id) => {
    if (!m.has(id)) {
      m.set(id, names.length);
      names.push(id);
    }
    return m.get(id);
  };

  function cache(rt, s) {
    let c = states.get(rt);
    if (!c || c.plan !== s || c.defs !== rt.defs) {
      c = {
        token: Core.allocateToken(),
        plan: s,
        defs: rt.defs,
        names: [],
        ids: new Map(),
        purposes: ['work', 'shopping', 'leisure'],
        purposeIds: new Map([
          ['work', 0],
          ['shopping', 1],
          ['leisure', 2]
        ]),
        sent: 0,
        seen: new WeakSet(),
        trains: new Map(),
        limitIds: new Set(),
        fallbackLimits: new Map()
      };
      states.set(rt, c);
    }
    return c;
  }

  function named(c, id) {
    return intern(c.ids, c.names, id);
  }

  function token(text) {
    const a = text.split(':');
    return [+a[0], +a[1], a.length > 2 ? +a[2] : -1];
  }

  function tokens(out, values, since, prefix) {
    const rows = Object.entries(values);
    out.push(rows.length);
    for (const [t, n] of rows) {
      out.push(...token(t), n);
      if (since) out.push(since[prefix + '#' + t] ?? NaN);
    }
  }

  function defs(c, rt, s, out) {
    out.push(rt.defs.length - c.sent);
    const runs = new Map(s.services.map(l => [l.id, l]));
    for (let i = c.sent; i < rt.defs.length; i++) {
      const j = rt.defs[i],
        byline = Object.entries(j.byLine),
        valid = j.legs.map(e => {
          const l = runs.get(e.service);
          if (!l || !X.directions(l).includes(e.dir)) return false;
          const calls = l.callStops || l.stops;
          return calls.includes(e.from) && calls.includes(e.to) && (l.stops[0] === l.stops.at(-
            1) || (l.stops.indexOf(e.to) - l.stops.indexOf(e.from)) * e.dir > 0);
        });
      for (let k = valid.length - 2; k >= 0; k--) valid[k] = valid[k] && valid[k + 1];
      out.push(j.id, j.fare, intern(c.purposeIds, c.purposes, j.purpose), byline.length);
      for (const [id, n] of byline) out.push(named(c, id), n);
      const ids = j.lineIds || [];
      out.push(ids.length, ...ids.map(id => named(c, id)));
      out.push(j.legs.length);
      j.legs.forEach((e, k) => {
        out.push(named(c, e.service), e.dir, e.from, e.to, +valid[k]);
        c.limitIds.add(e.from);
      });
    }
    c.sent = rt.defs.length;
  }

  function fullState(c, rt, out) {
    out.push(...counters.map(k => rt[k] ?? 0));
    for (const [value, kind] of [
        [rt.purposeCompleted, 'purpose'],
        [rt.lineRevenue, 'line'],
        [rt.lineBoarded, 'line']
      ]) {
      const rows = Object.entries(value || {});
      out.push(rows.length);
      for (const [k, n] of rows) out.push(kind === 'purpose' ? intern(c.purposeIds, c.purposes,
        k) : named(c, k), n);
    }
    const occ = Object.entries(rt.stationOccupancy || {});
    out.push(occ.length);
    for (const [k, n] of occ) out.push(+k, n);
    const outside = Object.entries(rt.outside || {});
    out.push(outside.length);
    for (const [id, q] of outside) {
      out.push(+id);
      tokens(out, q, rt.outsideSince, id);
      c.limitIds.add(+id);
    }
    const queues = Object.entries(rt.queues || {});
    out.push(queues.length);
    for (const [k, q] of queues) {
      const [id, dir, station] = k.split('|');
      out.push(named(c, id), +dir, +station);
      tokens(out, q, rt.waitSince, k);
      c.limitIds.add(+station);
    }
    out.push(rt.transfers.length);
    for (const x of rt.transfers) out.push(x.journey, x.leg, x.amount, x.ready, x.station);
  }

  function packet(c, rt, s, job, resume) {
    const full = Core.queueToken() !== c.token;
    if (full) {
      c.sent = 0;
      c.seen = new WeakSet();
    }
    const definition = [];
    defs(c, rt, s, definition);
    const fresh = rt.trains.filter(t => !c.seen.has(t)),
      trainData = [];
    trainData.push(fresh.length);
    for (const t of rt.trains) c.trains.set(uid(t), {
      t,
      l: t.retiringRun || job.index.runs.get(t.service)
    });
    for (const t of fresh) {
      c.seen.add(t);
      trainData.push(uid(t), named(c, t.service), named(c, t.parentLine || t.service), t.capacity,
        t.dir, +t.loop, (t.retiringRun || job.index.runs.get(t.service))?.cars || 6, t.stops
        .length, ...t.stops, t.callStops.length, ...t.callStops, t
        .onboard);
      tokens(trainData, t.passengers);
    }
    const snapshot = [];
    if (full) fullState(c, rt, snapshot);
    for (const id of Object.keys(rt.stationLimits || {})) c.limitIds.add(+id);
    const limits = [c.limitIds.size];
    for (const id of c.limitIds) {
      let l = rt.stationLimits[id] || c.fallbackLimits.get(id);
      if (!l) {
        l = Q.limits(s, id);
        c.fallbackLimits.set(id, l);
      }
      limits.push(id, l.capacity, l.outsideCapacity);
    }
    const motion = resume ? new Float64Array(0) : job.motion.input;
    const ops = resume?.ops || [],
      arrivals = resume ? [] : job.arrivals;
    const header = [2, c.token, resume ? 1 : 0, +full, rt.minute, s.routeModel === 9 ? 1 : 0, rt
      .arrivalMode === 'integer' ? 1 : 0, X.TRANSFER, resume ? 0 : +job.gates, resume?.cursor ||
      0, resume?.original ?? -1, resume?.next ?? -1, resume?.amount || 0, motion.length
    ];
    const tail = [rt.trains.length, ...rt.trains.map(uid), ops.length / 4, ...ops, arrivals
      .length
    ];
    arrivals.forEach((a, i) => {
      const ids = a.j.lineIds || [];
      tail.push(a.id, i, a.n, ids.length, ...ids.map(id => named(c, id)));
    });
    const statistics = Q.nativeStatisticsFrame(c, s, rt, full);
    const finance = job.settlement ? Engine.encode(c, rt, job.settlement, named, full) : null;
    const size = header.length + motion.length + definition.length + limits.length + trainData
      .length +
      snapshot.length + tail.length + statistics.length;
    // Encode directly into the transaction buffer; avoid a second full queue copy.
    const input = new Float64Array(size + (finance ? 2 + finance.length : 0));
    let at = finance ? 2 : 0;
    for (const part of [header, motion, definition, limits, trainData, snapshot, tail,
      statistics]) {
      input.set(part, at);
      at += part.length;
    }
    if (!finance) return {
      queue: Core.kernel('simulation_step', input)
    };
    input.set([size, finance.length]);
    input.set(finance, at);
    const result = Core.kernel('engine_step', input);
    return {
      queue: result.subarray(3, 3 + result[1]),
      finance: result.subarray(3 + result[1])
    };
  }

  function pose(rt, job, data) {
    for (let i = 0; i < job.motion.context.length; i++) {
      const {
        t
      } = job.motion.context[i], at = i * 8, action = data[at];
      if (action === 1) {
        t.status = 'finished';
        continue;
      }
      if (action >= 2 && action <= 5) {
        t.progress = data[at + 1];
        if (action >= 3) {
          t.index = data[at + 4];
          t.status = 'dwell';
          t.ready = data[at + 5];
          t.progress = 0;
          if (action === 4) {
            t.index = data[at + 6];
            t.ready = data[at + 7];
            t.laps = (t.laps || 0) + 1;
          } else if (action === 5) t.status = 'finished';
        }
      } else if (action === 6) t.status = 'signal';
      else if (action === 7) {
        const tr = job.track(rt, job.index, t, t.trackIds[t.dir === 1 ? t.index : t.index - 1]),
          from = t.stops[t.index],
          to = t.stops[t.index + t.dir],
          block = tr.id + '|' + (from === tr.a ? 1 : -1);
        rt.blocks[block] = data[at + 7];
        t.status = 'moving';
        t.departedAt = rt.minute;
        t.arriveAt = data[at + 5];
        t.segment = {
          track: tr.id,
          from,
          to
        };
        t.progress = 0;
      }
    }
  }

  function project(c, rt, s, job, data) {
    const pending = projectCommands(c, rt, s, job, data.queue);
    if (data.finance?.length) Engine.project(rt, job.settlement, data.finance);
    return pending;
  }

  function projectCommands(c, rt, s, job, data) {
    if (data[0] !== 1) throw Error('队列事件协议版本错误');
    const motionLength = data[6],
      opsLength = data[7] * 4,
      dirty = data[8];
    let at = 17;
    if (motionLength) pose(rt, job, data.subarray(at, at + motionLength));
    at += motionLength;
    const ops = data.slice(at, at + opsLength);
    at += opsLength;
    const statistics = Q.nativeStatisticsProjector(c, s, rt);
    const transferDeletes = [];
    const compactTransfers = () => {
      if (!transferDeletes.length) return;
      let deleted = 0,
        kept = 0;
      for (let read = 0; read < rt.transfers.length; read++) {
        if (read === transferDeletes[deleted]) deleted++;
        else rt.transfers[kept++] = rt.transfers[read];
      }
      rt.transfers.length = kept;
      transferDeletes.length = 0;
    };
    let lastToken = '',
      tj = -1,
      tl = -1,
      ts = -2,
      qid = -1,
      qdir = 0,
      qstation = -1,
      qkey = '';
    const tok = (j, l, stamp) => {
      if (tj !== j || tl !== l || ts !== stamp) {
        tj = j;
        tl = l;
        ts = stamp;
        lastToken = j + ':' + l + (stamp >= 0 ? ':' + stamp : '');
      }
      return lastToken;
    };
    const key = (id, dir, station) => {
      if (id !== qid || dir !== qdir || station !== qstation) {
        qid = id;
        qdir = dir;
        qstation = station;
        qkey = c.names[id] + '|' + dir + '|' + station;
      }
      return qkey;
    };
    const update = (obj, k, v) => {
      if (Number.isNaN(v)) delete obj[k];
      else obj[k] = v;
    };
    for (; at < data.length; at += 8) {
      const op = data[at],
        a = data[at + 1],
        b = data[at + 2],
        d = data[at + 3],
        e = data[at + 4],
        f = data[at + 5],
        g = data[at + 6],
        h = data[at + 7];
      if (op >= 32) {
        statistics(data, at);
        continue;
      }
      switch (op) {
        case 3: {
          const k = key(a, b, d),
            q = rt.queues[k] || (rt.queues[k] = {});
          update(q, tok(e, f, g), h);
          break;
        }
        case 4:
          update(rt.waitSince, key(a, b, d) + '#' + tok(e, f, g), h);
          break;
        case 5: {
          const q = rt.outside[a] || (rt.outside[a] = {});
          update(q, tok(b, d, e), f);
          break;
        }
        case 6:
          update(rt.outsideSince, a + '#' + tok(b, d, e), f);
          break;
        case 7:
          rt.stationOccupancy[a] = b;
          break;
        case 8:
          update(c.trains.get(a).t.passengers, tok(b, d, e), f);
          break;
        case 9:
          c.trains.get(a).t.onboard = b;
          break;
        case 10:
          c.trains.get(a).t.passengers = {};
          break;
        case 11:
          compactTransfers();
          rt.transfers.push({
            journey: a,
            leg: b,
            amount: d,
            ready: e,
            station: f
          });
          break;
        case 12:
          transferDeletes.push(a + transferDeletes.length);
          break;
        case 13:
          rt.lineRevenue[c.names[a]] = b;
          break;
        case 14:
          rt.lineBoarded[c.names[a]] = b;
          break;
        case 15:
          rt.purposeCompleted[c.purposes[a]] = b;
          break;
        case 16:
          rt.outside[a] = rt.outside[a] || {};
          break;
        default:
          throw Error('未知队列事件 ' + op);
      }
    }
    compactTransfers();
    for (let i = 0; i < 8; i++)
      if (dirty & (1 << i)) rt[counters[i]] = data[9 + i];
    return data[1] ? {
      cursor: data[2],
      original: data[3],
      station: data[4],
      amount: data[5],
      ops
    } : null;
  }

  function step(rt, s, index, track, arrivals, gates, reroute, settlement = null) {
    const c = cache(rt, s);
    // New games / compacted archives can release the previous arena before rehydration.
    // Do this before encoding motion so both native state machines receive full layouts.
    if (!c.sent && Core.queueToken() !== c.token && Core.status().memoryBytes > 64 * 1024 *
      1024) {
      Core.recycleSimulation();
    }
    const job = {
      settlement,
      index,
      track,
      arrivals,
      gates,
      motion: SIM.incremental(rt, s, index, track, uid)
    };
    let pending = project(c, rt, s, job, packet(c, rt, s, job, null));
    while (pending) {
      const next = reroute(rt, rt.defs[pending.original], pending.station);
      pending.next = next?.id ?? -1;
      pending = project(c, rt, s, job, packet(c, rt, s, job, pending));
    }
    rt.trains = rt.trains.filter(t => t.status !== 'finished');
    const alive = new Set(rt.trains.map(uid));
    for (const id of c.trains.keys())
      if (!alive.has(id)) c.trains.delete(id);
  }
  const api = {
    step
  };
  if (node) module.exports = api;
  else root.RailQueueRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
