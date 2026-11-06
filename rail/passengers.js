/* Weighted passenger cohorts retain their destination and transfer itinerary until arrival. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    R = node ? require('./engine') : root.RailSim,
    B = node ? require('./operations') : root.RailOperations,
    C = node ? require('./city') : root.RailCity;
  const X = node ? require('./service-plan') : root.RailServicePlan;
  const Q = node ? require('./ridership') : root.RailRidership;
  const F = node ? require('./fleet') : root.RailFleet;
  const SIM = node ? require('./simulation-wasm') : root.RailSimulation;
  const key = (id, dir, station) => `${id}|${dir}|${station}`;

  function definitions(s, m) {
    s = X.expand(s);
    return m.flows.map((f, id) => {
      const legs = [];
      let from = f.from,
        current = null;
      for (const e of f.path.edges) {
        const l = s.services.find(l => l.id === e.service),
          i = l.trackIds.findIndex((t, j) => t === e.track && ((l.stops[j] === from && l
            .stops[j +
              1] === e.to) || (l.stops[j + 1] === from && l.stops[j] === e.to))),
          dir = e.dir || (l.stops[i] === from ? 1 : -1);
        if (!current || current.service !== l.id || current.dir !== dir) {
          current = {
            service: l.id,
            dir,
            from,
            to: e.to
          };
          legs.push(current);
        } else current.to = e.to;
        from = e.to;
      }
      const byLine = {};
      if (f.path.fares && f.path.fare > 0) {
        for (const [id, amount] of Object.entries(f.path.fares)) byLine[id] = amount / f.path
          .fare;
      } else
        for (const e of f.path.edges) byLine[e.service] = (byLine[e.service] || 0) + e.km / f
          .path.km;
      return {
        id,
        legs,
        daily: f.demandTrips ?? f.trips,
        fare: f.path.fare,
        purpose: f.purpose || 'work',
        back: !!f.back,
        hub: f.hub || null,
        externalKind: f.externalKind || null,
        from: f.from,
        to: f.to,
        lineIds: Object.keys(f.path.fares || byLine),
        byLine
      };
    });
  }
  const MAX_SAVED_DEFINITIONS = 300000;
  const journeyKeys = new WeakMap();

  function journeyKey(j) {
    let key = journeyKeys.get(j);
    if (!key) {
      key = JSON.stringify([j.legs, j.from, j.to, j.purpose, j.back, j.hub, j.externalKind, j
        .fare, j
        .byLine
      ]);
      journeyKeys.set(j, key);
    }
    return key;
  }

  function validateCatalog(fresh) {
    if (!Array.isArray(fresh) || fresh.some(j => !Number.isFinite(j.daily) || j.daily < 0 || !
        Number
        .isFinite(j.fare) || j.fare < 0 || !j.legs?.length)) throw Error('客流预测包含无效出行，已保留上次需求。');
    return fresh;
  }

  function installCatalog(rt, fresh) {
    Object.defineProperty(rt, 'demandCatalog', {
      value: fresh,
      writable: true,
      configurable: true,
      enumerable: false
    });
    Object.defineProperty(rt, '_demandIndex', {
      value: null,
      writable: true,
      configurable: true,
      enumerable: false
    });
    rt.demandStatus = {
      profiles: fresh.length,
      daily: fresh.reduce((v, j) => v + j.daily, 0),
      activeProfiles: fresh.reduce((n, j) => n + (j.daily > 0 ? 1 : 0), 0),
      updatedAt: rt.minute,
      storage: 'lazy'
    };
  }

  function materialize(rt, j) {
    if (!rt.demandCatalog) return j;
    if (!rt._demandIndex) rt._demandIndex = new Map(rt.defs.map(j => [journeyKey(j), j]));
    const key = journeyKey(j);
    let live = rt._demandIndex.get(key);
    if (!live) {
      live = {
        ...j,
        id: rt.defs.length,
        daily: 0
      };
      rt.defs.push(live);
      rt._demandIndex.set(key, live);
    }
    return live;
  }

  function demandSummary(rt) {
    const catalog = rt.demandCatalog || rt.defs,
      stats = rt.demandCatalog ? rt.demandStatus : null;
    return {
      profiles: stats?.profiles ?? catalog.length,
      activeProfiles: stats?.activeProfiles ?? catalog.reduce((n, j) => n + (j.daily > 0 ? 1 : 0),
        0),
      daily: stats?.daily ?? catalog.reduce((n, j) => n + j.daily, 0),
      storedProfiles: rt.defs.length,
      lazy: !!rt.demandCatalog
    };
  }

  function create(s, m, start = 420, warm = true) {
    Q.init(s, start);
    const plan = X.expand(s);
    const rt = {
      plan,
      city: true,
      minute: start - (warm ? 30 : 0),
      nextId: 1,
      arrivalMode: s.routeModel === 9 ? 'integer' : 'weighted',
      arrivalRemainder: 0,
      expectedGenerated: 0,
      rngState: 2463534242,
      stationOccupancy: {},
      stationLimits: Object.fromEntries([...new Set(plan.services.flatMap(l => l.callStops || l
          .stops))]
        .map(id => [id, Q.limits(s, id)])),
      outside: {},
      outsideSince: {},
      rejected: 0,
      trains: [],
      transfers: [],
      departures: {},
      blocks: {},
      queues: {},
      waitSince: {},
      defs: [],
      generated: 0,
      boarded: 0,
      alighted: 0,
      completed: 0,
      cancelled: 0,
      revenue: 0,
      vehicleExpense: 0,
      lineRevenue: {},
      lineBoarded: {},
      purposeCompleted: {
        work: 0,
        shopping: 0,
        leisure: 0
      }
    };
    const catalog = validateCatalog(m.preparedDefinitions || definitions(s, m));
    rt.defs = catalog.length <= 55000 ? catalog.map(j => ({
      ...j
    })) : [];
    installCatalog(rt, catalog);
    for (const [i, l] of plan.services.entries())
      for (const dir of X.directions(l)) rt.departures[l.id + '|' + dir] = {
        next: rt.minute + (i % 5) * .45 + (dir === -1 ? R.effectiveHeadway(s, l) / 2 : 0),
        headway: R.effectiveHeadway(s, l)
      };
    if (warm) advance(rt, s, 30);
    return rt;
  }

  function enqueue(rt, j, leg, amount, reserved = false) {
    const l = j.legs[leg],
      k = key(l.service, l.dir, l.from),
      q = rt.queues[k] || (rt.queues[k] = {}),
      token = j.id + ':' + leg + (rt.arrivalMode === 'integer' ? ':' + Math.floor(rt.minute) :
        '');
    if (!q[token]) rt.waitSince[k + '#' + token] = rt.minute;
    q[token] = (q[token] || 0) + amount;
    if (!reserved) rt.stationOccupancy[l.from] = (rt.stationOccupancy[l.from] || 0) + amount;
  }

  function waitingTransfer(rt, j, leg, n) {
    if (n <= 0) return;
    const l = j.legs[leg];
    rt.stationOccupancy[l.from] = (rt.stationOccupancy[l.from] || 0) + n;
    rt.transfers.push({
      journey: j.id,
      leg,
      amount: n,
      ready: rt.minute + X.TRANSFER,
      station: l.from
    });
  }

  function reject(rt, s, j, n) {
    if (n <= 0) return;
    rt.cancelled += n;
    rt.rejected = (rt.rejected || 0) + n;
    Q.event(s, rt, j, 'reject', n);
  }

  function admit(rt, s, j, leg, amount, transfer = false) {
    if (s.routeModel !== 9) {
      if (transfer) waitingTransfer(rt, j, leg, amount);
      else enqueue(rt, j, leg, amount);
      return;
    }
    const id = j.legs[leg].from,
      limit = rt.stationLimits[id] || Q.limits(s, id),
      inside = Math.max(0, Math.min(amount, limit.capacity - (rt.stationOccupancy[id] || 0)));
    if (inside) {
      if (!transfer && leg === 0) Q.event(s, rt, j, 'enter', inside, 0, null, id);
      if (transfer) waitingTransfer(rt, j, leg, inside);
      else enqueue(rt, j, leg, inside);
    }
    let rest = amount - inside;
    if (rest > 0) {
      const outside = rt.outside[id] || (rt.outside[id] = {}),
        token = j.id + ':' + leg + ':' + Math.floor(rt.minute),
        total = Object.values(outside).reduce((v, n) => v + n, 0),
        take = Math.max(0, Math.min(rest, limit.outsideCapacity - total));
      if (take) {
        if (!outside[token]) rt.outsideSince[id + '#' + token] = rt.minute;
        outside[token] = (outside[token] || 0) + take;
        rest -= take;
      }
      reject(rt, s, j, rest);
    }
  }

  function gates(rt, s) {
    for (const [id, q] of Object.entries(rt.outside)) {
      const limit = rt.stationLimits[id] || Q.limits(s, +id);
      for (const [token, n] of Object.entries(q)) {
        const [ji, leg] = token.split(':').map(Number), j = rt.defs[ji], since = rt.outsideSince[
          id + '#' +
          token] ?? rt.minute;
        if (rt.minute - since >= 15) {
          reject(rt, s, j, n);
          delete q[token];
          delete rt.outsideSince[id + '#' + token];
          continue;
        }
        if (leg > 0 && rt.minute - since < X.TRANSFER) continue;
        const take = Math.max(0, Math.min(n, limit.capacity - (rt.stationOccupancy[id] || 0)));
        if (take) {
          if (leg === 0) Q.event(s, rt, j, 'enter', take, 0, null, +id);
          enqueue(rt, j, leg, take);
          q[token] -= take;
          if (q[token] < 1e-9) {
            delete q[token];
            delete rt.outsideSince[id + '#' + token];
          }
        }
      }
    }
    for (const [k, q] of Object.entries(rt.queues)) {
      const id = +k.split('|')[2];
      for (const [token, n] of Object.entries(q))
        if (rt.minute - (rt.waitSince[k + '#' + token] ?? rt.minute) > 60) {
          reject(rt, s, rt.defs[+token.split(':')[0]], n);
          rt.stationOccupancy[id] = Math.max(0, (rt.stationOccupancy[id] || 0) - n);
          delete q[token];
          delete rt.waitSince[k + '#' + token];
        }
    }
  }

  function generate(rt, s, dt) {
    if (rt.demandCatalog && rt.defs.length > 45000 && rt.minute - (rt.lastDefCompact ?? -
        Infinity) >= 5) {
      compactDefinitions(rt);
      rt.lastDefCompact = rt.minute;
      rt._demandIndex = null;
    }
    rt.demandCarry = (rt.demandCarry || 0) + dt;
    if (rt.demandCarry < 1 - 1e-9) return;
    const interval = Math.floor(rt.demandCarry + 1e-9);
    rt.demandCarry -= interval;
    dt = interval;
    Q.step(s, rt, dt);
    if (rt.arrivalMode === 'integer') gates(rt, s);
    const catalog = rt.demandCatalog || rt.defs,
      minute = Math.round(rt.minute * 1e6) / 1e6,
      rates = {};
    for (const p of ['work', 'shopping', 'leisure'])
      for (const b of [false, true]) rates[p + ':' + b] = C.profile(p, b, minute) * dt;
    const open = new Set(s.services.filter(l => B.isOpen(l, minute) && (!l.fleetManaged || l
        .fleet > 0))
      .map(l => l.id));

    function arrive(j, n) {
      if (n <= 0) return;
      rt.generated += n;
      Q.event(s, rt, j, 'attempt', n);
      if (!open.has(j.legs[0]?.service)) rt.cancelled += n;
      else admit(rt, s, materialize(rt, j), 0, n);
    }
    if (rt.arrivalMode !== 'integer') {
      for (const j of catalog) {
        const amount = j.daily * (j.externalKind ? C.profile(j.purpose, j.back, minute, j
            .externalKind) *
          dt : rates[j.purpose + ':' + j.back]);
        if (amount >= 1e-12) arrive(j, amount);
      }
      return;
    }
    // Global residual + systematic sampling: a tiny OD is not rounded away independently.
    // Expected total is preserved to less than one passenger; actual queues contain whole people.
    const sampled = SIM.arrivals(catalog, j => Q.factor(s, j), j => j.externalKind ? C.profile(j
        .purpose, j.back,
        minute, j.externalKind) * dt : rates[j.purpose + ':' + j.back], rt.arrivalRemainder ||
      0, rt.rngState);
    rt.expectedGenerated = (rt.expectedGenerated || 0) + sampled.total;
    rt.arrivalRemainder = sampled.remainder;
    rt.rngState = sampled.rng;
    for (let i = 0; i < sampled.events.length; i += 2) arrive(catalog[sampled.events[i]], sampled
      .events[i + 1]);
  }

  function board(rt, t) {
    const s = rt.plan,
      {
        k,
        tokens,
        data
      } = SIM.boarding(rt, t),
      q = rt.queues[k];
    for (let i = 0; i < data[0]; i++) {
      const at = 1 + i * 4,
        token = tokens[data[at]],
        action = data[at + 1],
        take = data[at + 2],
        wait = data[at + 3];
      if (action === 2) {
        reject(rt, s, rt.defs[+token.split(':')[0]], take);
        rt.stationOccupancy[t.stops[t.index]] = Math.max(0, (rt.stationOccupancy[t.stops[t
          .index]] || 0) - take);
      } else if (action === 3) {
        t.passengers[token] = (t.passengers[token] || 0) + take;
        t.onboard += take;
        rt.boarded += take;
        rt.stationOccupancy[t.stops[t.index]] = Math.max(0, (rt.stationOccupancy[t.stops[t
          .index]] || 0) - take);
        Q.event(s, rt, rt.defs[+token.split(':')[0]], 'board', take, wait, t.parentLine || t
          .service, t.stops[t.index]);
        rt.lineBoarded[t.service] = (rt.lineBoarded[t.service] || 0) + take;
        q[token] -= take;
      }
      if (action !== 3 || q[token] < 1e-9) {
        delete q[token];
        delete rt.waitSince[k + '#' + token];
      }
    }
  }

  function unload(rt, t) {
    const n = t.stops[t.index];
    for (const [token, count] of Object.entries(t.passengers)) {
      const [id, leg] = token.split(':').map(Number), j = rt.defs[id];
      if (!j || j.legs[leg]?.to !== n) continue;
      t.onboard -= count;
      rt.alighted += count;
      Q.event(rt.plan, rt, j, 'alight', count, 0, null, n);
      delete t.passengers[token];
      if (j.legs[leg + 1]) {
        if (j.legs.slice(leg + 1).every(e => legValid(rt.plan, e))) admit(rt, rt.plan, j, leg + 1,
          count,
          true);
        else {
          const next = reroute(rt, j, n);
          if (next) admit(rt, rt.plan, next, 0, count, true);
          else reject(rt, rt.plan, j, count);
        }
      } else {
        rt.completed += count;
        Q.event(rt.plan, rt, j, 'complete', count);
        rt.revenue += count * j.fare;
        rt.purposeCompleted[j.purpose] += count;
        for (const [line, share] of Object.entries(j.byLine)) rt.lineRevenue[line] = (rt
          .lineRevenue[
            line] || 0) + count * j.fare * share;
      }
    }
    t.onboard = Math.max(0, t.onboard);
  }

  function refreshFleet(rt) {
    for (const l of rt.plan.services) {
      if (!l.fleetManaged) continue;
      const base = rt.plan.baseLines.find(b => b.id === l.parentLine);
      l.fleet = F.allocations(base, rt.minute)[l.patternIndex];
      for (const dir of X.directions(l)) {
        const d = rt.departures[l.id + '|' + dir],
          h = R.effectiveHeadway(rt.plan, l);
        if (d && h !== d.headway) {
          d.next = Number.isFinite(h) ? Math.max(rt.minute, Math.min(d.next, (d.lastRun ?? rt
              .minute) +
            h)) : Infinity;
          d.headway = h;
        }
      }
    }
  }
  const planIndexes = new WeakMap();

  function planIndex(s) {
    let c = planIndexes.get(s);
    if (!c || c.services !== s.services || c.tracks !== s.tracks || c.bases !== s.baseLines || c
      .trackCount !== s.tracks.length || c.runCount !== s.services.length) {
      c = {
        trackCount: s.tracks.length,
        runCount: s.services.length,
        services: s.services,
        tracks: s.tracks,
        bases: s.baseLines,
        runs: new Map(s.services.map(l => [l.id, l])),
        track: new Map(s.tracks.map(t => [t.id, t])),
        base: new Map((s.baseLines || []).map(l => [l.id, l])),
        archives: new Map()
      };
      planIndexes.set(s, c);
    }
    return c;
  }

  function trainTrack(rt, index, t, id) {
    if (!t.retiringKey) return index.track.get(id);
    let tracks = index.archives.get(t.retiringKey);
    const archive = rt.routeArchives?.[t.retiringKey];
    if (!tracks || tracks.source !== archive?.tracks) {
      tracks = {
        source: archive?.tracks,
        map: new Map((archive?.tracks || []).map(tr => [tr.id, tr]))
      };
      index.archives.set(t.retiringKey, tracks);
    }
    return tracks.map.get(id) || index.track.get(id);
  }

  function tick(rt, s, dt) {
    s = rt.plan || s;
    rt.minute += dt;
    if (Math.floor(rt.minute) !== rt.fleetMinute) {
      refreshFleet(rt);
      rt.fleetMinute = Math.floor(rt.minute);
    }
    for (const x of [...rt.transfers])
      if (x.ready <= rt.minute) {
        enqueue(rt, rt.defs[x.journey], x.leg, x.amount, true);
        rt.transfers.splice(rt.transfers.indexOf(x), 1);
      } generate(rt, s, dt);
    const index = planIndex(s);
    for (const {
        l,
        dir,
        d,
        action,
        next
      }
      of SIM.dispatch(rt, s, index)) {
      if (action < 0) continue;
      if (action === 1) {
        const loop = l.stops[0] === l.stops.at(-1);
        rt.trains.push({
          id: 'T' + String(rt.nextId++).padStart(4, '0'),
          service: l.id,
          parentLine: l.parentLine || l.id,
          callStops: l.callStops || l.stops,
          dir,
          stops: [...l.stops],
          trackIds: [...l.trackIds],
          index: dir === 1 ? 0 : l.stops.length - 1,
          status: 'dwell',
          ready: rt.minute + (loop ? X.loopDwell(s, l) : B.DWELL),
          onboard: 0,
          capacity: R.capacity(l),
          passengers: {},
          progress: 0,
          loop,
          segment: null
        });
        d.lastRun = rt.minute;
      }
      d.next = next;
    }
    const batch = SIM.motion(rt, s, index, trainTrack);
    for (let i = 0; i < batch.context.length; i++) {
      const {
        t,
        l
      } = batch.context[i], row = batch.data.subarray(i * 8, i * 8 + 8), action = row[0];
      if (action === 0) continue;
      if (action === 1) {
        t.status = 'finished';
        rt.cancelled += t.onboard;
        t.onboard = 0;
        continue;
      }
      if (action >= 2 && action <= 5) {
        t.progress = row[1];
        Q.travel(s, rt, t, row[2], l);
        rt.vehicleExpense += row[3];
        if (action >= 3) {
          t.index = row[4];
          t.status = 'dwell';
          t.ready = row[5];
          t.progress = 0;
          if (t.callStops.includes(t.stops[t.index])) unload(rt, t);
          if (action === 4) {
            t.index = row[6];
            t.ready = row[7];
            t.laps = (t.laps || 0) + 1;
          } else if (action === 5) {
            rt.cancelled += t.onboard;
            t.onboard = 0;
            t.passengers = {};
            t.status = 'finished';
          }
        }
      } else if (action === 6) t.status = 'signal';
      else if (action === 7) {
        const tr = trainTrack(rt, index, t, t.trackIds[t.dir === 1 ? t.index : t.index - 1]);
        const from = t.stops[t.index],
          to = t.stops[t.index + t.dir],
          block = tr.id + '|' + (from === tr.a ? 1 : -1);
        board(rt, t);
        rt.blocks[block] = row[7];
        t.status = 'moving';
        t.departedAt = rt.minute;
        t.arriveAt = row[5];
        t.segment = {
          track: tr.id,
          from,
          to
        };
        t.progress = 0;
      }
    }
    rt.trains = rt.trains.filter(t => t.status !== 'finished');
  }

  function advance(rt, s, minutes) {
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) throw Error(
      'Invalid simulation interval');
    let left = minutes;
    while (left > 1e-9) {
      const dt = Math.min(.1, left);
      tick(rt, s, dt);
      left -= dt;
    }
    return rt;
  }

  function summary(rt) {
    const transferring = (rt.transfers || []).reduce((v, x) => v + x.amount, 0),
      outside = Object.values(rt.outside || {}).reduce((v, q) => v + Object.values(q).reduce((a,
          b) => a +
        b, 0), 0),
      waiting = outside + transferring + Object.values(rt.queues).reduce((v, q) => v + Object
        .values(q)
        .reduce((a, b) => a + b, 0), 0),
      onboard = rt.trains.reduce((v, t) => v + t.onboard, 0);
    return {
      active: rt.trains.length,
      waiting,
      inside: waiting - outside,
      outside,
      transferring,
      onboard,
      completed: rt.completed,
      cancelled: rt.cancelled,
      generated: rt.generated,
      revenue: rt.revenue
    };
  }

  function station(rt, id) {
    let waiting = 0;
    const lines = {},
      destinations = {},
      purposes = {
        work: 0,
        shopping: 0,
        leisure: 0
      };
    for (const [k, q] of Object.entries(rt.queues)) {
      const [line, dir, node] = k.split('|');
      if (+node !== id) continue;
      for (const [token, count] of Object.entries(q)) {
        waiting += count;
        const j = rt.defs[+token.split(':')[0]];
        if (j) {
          destinations[j.to] = (destinations[j.to] || 0) + count;
          purposes[j.purpose] += count;
        }
        lines[line] = (lines[line] || 0) + count;
      }
    }
    let transferring = 0;
    for (const x of rt.transfers || [])
      if (x.station === id) {
        transferring += x.amount;
        waiting += x.amount;
        const j = rt.defs[x.journey];
        if (j) {
          destinations[j.to] = (destinations[j.to] || 0) + x.amount;
          purposes[j.purpose] += x.amount;
          const line = j.legs[x.leg].service;
          lines[line] = (lines[line] || 0) + x.amount;
        }
      } const outside = Object.values(rt.outside?.[id] || {}).reduce((v, n) => v + n, 0),
      limit = Q.limits(rt.plan, id);
    return {
      today: Q.station(rt.plan, id, rt.minute),
      waiting,
      outside,
      capacity: limit.capacity,
      outsideCapacity: limit.outsideCapacity,
      transferring,
      lines,
      destinations,
      purposes
    };
  }

  function snapshot(rt) {
    const out = {
      ...rt
    };
    if (rt.plan.urban) out.urbanDefs = rt.defs;
    delete out.defs;
    delete out.plan;
    return out;
  }

  function restore(s, m, saved) {
    try {
      if (!saved || !Number.isFinite(saved.minute) || saved.minute < 420 || saved.minute > 1e8 ||
        !Array
        .isArray(saved.trains) || saved.trains.length > 2400 || !saved.queues || !saved.waitSince)
        return null;
      if (!saved.stationOccupancy || !saved.outside || !saved.outsideSince) return null;
      if (saved.arrivalMode === 'integer' && (!Number.isFinite(saved.arrivalRemainder) || saved
          .arrivalRemainder < 0 || saved.arrivalRemainder >= 1 + 1e-8 || !Number.isFinite(saved
            .expectedGenerated) || saved.expectedGenerated < 0 || !Number.isInteger(saved
            .rngState) || saved
          .rngState < 0 || saved.rngState > 4294967295)) return null;
      const plan = X.expand(s),
        rt = {
          ...saved,
          transfers: saved.transfers || [],
          plan,
          defs: definitions(s, m)
        };
      if (!Array.isArray(saved.retiredTracks || []) || (saved.retiredTracks || []).length >
        5000 || (saved
          .retiredTracks || []).some(t => typeof t.id !== 'string' || !s.nodes[t.a] || !s.nodes[t
            .b] || !
          Number.isFinite(t.km) || t.km <= 0 || t.bends?.some(p => !Number.isFinite(p.x) || !
            Number
            .isFinite(p.y)))) return null;
      plan.tracks = [...s.tracks, ...(saved.retiredTracks || []).filter(t => !s.tracks.some(x => x
        .id === t
        .id))];
      if (saved.routeArchives && (typeof saved.routeArchives !== 'object' || Object.keys(saved
          .routeArchives).length > 2400 || Object.values(saved.routeArchives).some(a => !Array
          .isArray(a
            .tracks) || a.tracks.length > 120 || a.tracks.some(t => typeof t.id !== 'string' ||
            !s.nodes[t
              .a] || !s.nodes[t.b] || !Number.isFinite(t.km) || t.km <= 0 || [...(t.bends ||
            []), t.curve
              ?.before, t.curve?.after
            ].filter(Boolean).some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))))))
        return null;
      plan.routeArchives = saved.routeArchives || {};
      if (s.urban && saved.urbanDefs) {
        if (!Array.isArray(saved.urbanDefs) || saved.urbanDefs.length > MAX_SAVED_DEFINITIONS ||
          saved
          .urbanDefs.some((j, i) => j.id !== i || !Number.isFinite(j.daily) || j.daily < 0 || !
            Number
            .isFinite(j.fare) || j.fare < 0 || !Array.isArray(j.legs) || !j.legs.length || j.legs
            .some(
              e => {
                const l = plan.services.find(l => l.id === e.service);
                return ![1, -1].includes(e.dir) || !s.nodes[e.from] || !s.nodes[e.to] || (j
                  .daily > 0 && (!
                    l || !l.stops.includes(e.from) || !l.stops.includes(e.to)));
              }))) return null;
        rt.defs = saved.urbanDefs;
      }
      if (!['generated', 'completed', 'cancelled', 'boarded', 'alighted', 'revenue',
          'vehicleExpense',
          'nextId'
        ].every(k => Number.isFinite(rt[k]) && rt[k] >= 0)) return null;
      for (const t of rt.trains) {
        const l = t.retiringRun || plan.services.find(l => l.id === t.service);
        if (t.retiringKey && !plan.routeArchives[t.retiringKey]) return null;
        if (t.retiringRun && (!Array.isArray(l.stops) || !Array.isArray(l.trackIds) || l.stops
            .length !== l
            .trackIds.length + 1 || l.stops.length > 120 || l.stops.some(id => !s.nodes[id]) || l
            .trackIds
            .some((id, i) => !(plan.routeArchives[t.retiringKey]?.tracks || plan.tracks).some(
              tr => tr
              .id === id && R.key(tr.a, tr.b) === R.key(l.stops[i], l.stops[i + 1])))))
          return null;
        if (!l || t.stops.join() !== l.stops.join() || t.trackIds.join() !== l.trackIds.join() ||
          !Number
          .isFinite(t.capacity) || t.capacity !== R.capacity(l) || !Number.isFinite(t.onboard) ||
          t
          .onboard < 0 || t.onboard > R.capacity(l) + 1e-5 || !['moving', 'dwell', 'signal']
          .includes(t
            .status) || !Number.isInteger(t.index) || !s.nodes[t.stops[t.index]]) return null;
        for (const token of Object.keys(t.passengers))
          if (!rt.defs[+token.split(':')[0]]) return null;
      }
      for (const [k, q] of Object.entries(rt.queues)) {
        if (!/^s\d+(?:p\d+)?\|(-1|1)\|\d+$/.test(k)) return null;
        for (const [token, n] of Object.entries(q))
          if (!/^\d+:\d+(?::\d+)?$/.test(token) || !rt.defs[+token.split(':')[0]] || !Number
            .isFinite(n) ||
            n < 0) return null;
      }
      if (!Array.isArray(rt.transfers) || rt.transfers.some(x => !rt.defs[x.journey]?.legs[x
            .leg] || !Number
          .isFinite(x.amount) || x.amount < 0 || !Number.isFinite(x.ready) || !s.nodes[x.station]
        ))
        return null;
      const counted = {};
      for (const [k, q] of Object.entries(rt.queues)) {
        const id = +k.split('|')[2];
        counted[id] = (counted[id] || 0) + Object.values(q).reduce((a, b) => a + b, 0);
      }
      for (const t of rt.transfers) counted[t.station] = (counted[t.station] || 0) + t.amount;
      for (const [id, q] of Object.entries(rt.outside)) {
        if (!s.nodes[+id] || typeof q !== 'object') return null;
        for (const [token, n] of Object.entries(q)) {
          const [ji, leg] = token.split(':').map(Number);
          if (!rt.defs[ji]?.legs[leg] || rt.defs[ji].legs[leg].from !== +id || !Number.isFinite(
              n) || n <
            0 || !Number.isFinite(rt.outsideSince[id + '#' + token])) return null;
        }
        if (s.routeModel === 9 && Object.values(q).reduce((a, b) => a + b, 0) > Math.max(Q.limits(
              s, +id)
            .outsideCapacity, Math.min(10000, saved.stationLimits?.[id]?.outsideCapacity || 0)) +
          1e-5)
          return null;
      }
      for (const id of new Set([...Object.keys(counted), ...Object.keys(rt.stationOccupancy)])) {
        const n = counted[id] || 0;
        if (!Number.isFinite(rt.stationOccupancy[id] || 0) || Math.abs(n - (rt.stationOccupancy[
            id] || 0)) >
          1e-5) return null;
        if (s.routeModel === 9 && n > Math.max(Q.limits(s, +id).capacity, Math.min(20000, saved
            .stationLimits?.[id]?.capacity || 0)) + 1e-5) return null;
      }
      const x = summary(rt);
      if (Math.abs(x.generated - x.completed - x.cancelled - x.waiting - x.onboard) > Math.max(.1,
          x
          .generated * 1e-8)) return null;
      installCatalog(rt, validateCatalog(m.preparedDefinitions || definitions(s, m)));
      return rt;
    } catch {
      return null;
    }
  }
  // A changed route drains its existing vehicles to their original terminus. New departures
  // use the new route immediately; existing passenger contracts retain their fare and destination.
  function routeKey(l, plan) {
    return JSON.stringify([l.stops, l.trackIds, l.callStops || l.stops, X.directions(l), l
      .trackIds.map(
        id => {
          const t = plan.tracks.find(t => t.id === id);
          return [t?.km, t?.curve, t?.bends];
        })
    ]);
  }

  function legValid(plan, e) {
    const l = plan.services.find(l => l.id === e.service);
    if (!l || !X.directions(l).includes(e.dir)) return false;
    const calls = l.callStops || l.stops;
    if (!calls.includes(e.from) || !calls.includes(e.to)) return false;
    return l.stops[0] === l.stops.at(-1) || (l.stops.indexOf(e.to) - l.stops.indexOf(e.from)) * e
      .dir > 0;
  }

  function reroute(rt, j, from) {
    if (from === j.to) return null;
    if (!rt._routes) Object.defineProperty(rt, '_routes', {
      value: new Map(),
      writable: true,
      configurable: true
    });
    const cacheKey = from + '|' + j.to + '|' + j.purpose + '|' + j.fare;
    let cached = rt._routes.get(cacheKey);
    if (cached !== undefined) return cached;
    const pathKey = 'paths|' + from + '|' + j.purpose;
    let paths = rt._routes.get(pathKey);
    if (!paths) {
      paths = R.paths(rt.plan, R.network(rt.plan), from, 1 / X.VOT[j.purpose || 'work']);
      rt._routes.set(pathKey, paths);
    }
    const path = paths[j.to];
    if (!path?.edges?.length) {
      rt._routes.set(cacheKey, null);
      return null;
    }
    const next = definitions(rt.plan, {
      flows: [{
        from,
        to: j.to,
        purpose: j.purpose,
        back: j.back,
        hub: j.hub,
        externalKind: j.externalKind,
        demandTrips: 0,
        path
      }]
    })[0];
    next.id = rt.defs.length;
    next.fare = j.fare;
    rt.defs.push(next);
    rt._routes.set(cacheKey, next);
    return next;
  }

  function compactDefinitions(rt) {
    const ids = new Set(),
      add = token => ids.add(+token.split(':')[0]);
    for (const q of Object.values(rt.queues)) Object.keys(q).forEach(add);
    for (const q of Object.values(rt.outside)) Object.keys(q).forEach(add);
    for (const t of rt.trains) Object.keys(t.passengers).forEach(add);
    for (const x of rt.transfers) ids.add(x.journey);
    const mapping = new Map(),
      defs = [];
    for (const j of rt.defs)
      if (ids.has(j.id)) {
        mapping.set(j.id, defs.length);
        defs.push({
          ...j,
          id: defs.length,
          daily: 0
        });
      } const token = t => {
        const parts = t.split(':');
        parts[0] = mapping.get(+parts[0]);
        return parts.join(':');
      },
      remap = q => Object.fromEntries(Object.entries(q).map(([t, n]) => [token(t), n]));
    for (const k of Object.keys(rt.queues)) rt.queues[k] = remap(rt.queues[k]);
    for (const k of Object.keys(rt.outside)) rt.outside[k] = remap(rt.outside[k]);
    for (const t of rt.trains) t.passengers = remap(t.passengers);
    for (const x of rt.transfers) x.journey = mapping.get(x.journey);
    for (const field of ['waitSince', 'outsideSince']) rt[field] = Object.fromEntries(Object
      .entries(rt[
        field]).filter(([k]) => mapping.has(+k.split('#')[1]?.split(':')[0])).map(([k, v]) => {
        const [key, t] = k.split('#');
        return [key + '#' + token(t), v];
      }));
    rt.defs = defs;
    rt._routes = null;
  }

  function reconcile(rt, s, m = null) {
    const prediction = m ? validateCatalog(m.preparedDefinitions || definitions(s, m)) : null,
      fresh = prediction === rt.defs ? prediction.map(j => ({
        ...j
      })) : prediction;
    const previous = rt.plan,
      plan = X.expand(s),
      oldRuns = new Map(previous.services.map(l => [l.id, l])),
      runs = new Map(plan.services.map(l => [l.id, l]));
    const archives = rt.routeArchives || {},
      versions = new Map();
    for (const t of rt.trains) {
      const before = t.retiringRun || oldRuns.get(t.service),
        after = runs.get(t.service);
      if (!t.retiringRun && before && (!after || routeKey(before, previous) !== routeKey(after,
          plan))) {
        t.retiringRun = R.clone(before);
        let k = versions.get(t.service);
        if (!k) {
          k = 'r' + (rt.nextRouteRevision = (rt.nextRouteRevision || 0) + 1);
          versions.set(t.service, k);
          archives[k] = {
            tracks: R.clone(previous.tracks.filter(tr => before.trackIds.includes(tr.id)))
          };
        }
        t.retiringKey = k;
      }
    }
    rt.routeArchives = Object.fromEntries(Object.entries(archives).filter(([k]) => rt.trains.some(
      t => t
      .retiringKey === k)));
    plan.routeArchives = rt.routeArchives;
    const needed = new Set(rt.trains.filter(t => t.retiringRun).flatMap(t => t.trackIds));
    rt.retiredTracks = previous.tracks.filter(t => needed.has(t.id) && !s.tracks.some(x => x
      .id === t.id));
    plan.tracks = [...s.tracks, ...rt.retiredTracks];
    rt.plan = plan;
    rt._routes = null;
    // Histories and finance are references to the current live city, never a worker snapshot.
    rt.stationLimits = Object.fromEntries([...new Set(plan.services.flatMap(l => l.callStops || l
        .stops))]
      .map(id => [id, Q.limits(s, id)]));
    if (fresh) {
      if (rt.defs.length + fresh.length > 55000) compactDefinitions(rt);
      for (const j of rt.defs) j.daily = 0;
      installCatalog(rt, fresh);
    } else {
      for (const j of rt.defs)
        if (!j.legs.every(e => legValid(plan, e))) j.daily = 0;
      if (rt.demandCatalog) installCatalog(rt, rt.demandCatalog.filter(j => j.legs.every(e =>
        legValid(plan,
          e))));
    }
    const migrate = (token, count, station, since, put) => {
      const [id, leg] = token.split(':').map(Number), j = rt.defs[id];
      if (j?.legs.slice(leg).every(e => legValid(plan, e))) {
        put(j, leg, token, count, since);
        return;
      }
      const next = j && reroute(rt, j, station);
      if (next) put(next, 0, next.id + ':0:' + Math.floor(since), count, since);
      else reject(rt, s, j, count);
    };
    const queues = {},
      waitSince = {},
      occupancy = {};
    for (const [k, q] of Object.entries(rt.queues))
      for (const [token, n] of Object.entries(q)) {
        const station = +k.split('|')[2],
          since = rt.waitSince[k + '#' + token] ?? rt.minute;
        migrate(token, n, station, since, (j, leg, tok, count, at) => {
          const e = j.legs[leg],
            k = key(e.service, e.dir, e.from),
            q = queues[k] || (queues[k] = {});
          q[tok] = (q[tok] || 0) + count;
          waitSince[k + '#' + tok] = Math.min(waitSince[k + '#' + tok] ?? at, at);
          occupancy[station] = (occupancy[station] || 0) + count;
        });
      }
    rt.queues = queues;
    rt.waitSince = waitSince;
    const transfers = [];
    for (const x of rt.transfers) migrate(x.journey + ':' + x.leg, x.amount, x.station, x.ready -
      X
      .TRANSFER, (j, leg, tok, count) => {
        transfers.push({
          ...x,
          journey: j.id,
          leg,
          amount: count
        });
        occupancy[x.station] = (occupancy[x.station] || 0) + count;
      });
    rt.transfers = transfers;
    rt.stationOccupancy = occupancy;
    for (const [id, n] of Object.entries(occupancy))
      if (rt.stationLimits[id]) rt.stationLimits[id].capacity = Math.max(rt.stationLimits[id]
        .capacity, n);
    const outside = {},
      outsideSince = {};
    for (const [id, q] of Object.entries(rt.outside))
      for (const [token, n] of Object.entries(q)) migrate(token, n, +id, rt.outsideSince[id +
        '#' +
        token] ?? rt.minute, (j, leg, tok, count, at) => {
        const q = outside[id] || (outside[id] = {});
        q[tok] = (q[tok] || 0) + count;
        outsideSince[id + '#' + tok] = Math.min(outsideSince[id + '#' + tok] ?? at, at);
      });
    rt.outside = outside;
    rt.outsideSince = outsideSince;
    for (const [id, q] of Object.entries(outside))
      if (rt.stationLimits[id]) rt.stationLimits[id].outsideCapacity = Math.max(rt.stationLimits[
          id]
        .outsideCapacity, Object.values(q).reduce((v, n) => v + n, 0));
    for (const l of plan.services)
      for (const dir of X.directions(l)) {
        const k = l.id + '|' + dir,
          h = R.effectiveHeadway(plan, l),
          d = rt.departures[k];
        if (!d) rt.departures[k] = {
          next: rt.minute,
          headway: h
        };
        else if (d.headway !== h) {
          d.next = Number.isFinite(h) ? Math.max(rt.minute, Math.min(d.next, (d.lastRun ?? rt
              .minute) +
            h)) : Infinity;
          d.headway = h;
        }
      }
    rt.fleetMinute = -1;
    return rt;
  }

  function rebase(rt, s, m) {
    return reconcile(rt, s, m);
  }
  const api = {
    demandSummary,
    MAX_SAVED_DEFINITIONS,
    reconcile,
    rebase,
    create,
    advance,
    position: (s, t, scale) => B.position(t.retiringKey && s.routeArchives?.[t.retiringKey] ? {
      ...s,
      tracks: s.routeArchives[t.retiringKey].tracks
    } : s, t, scale),
    summary,
    station,
    snapshot,
    restore,
    definitions
  };
  if (node) module.exports = api;
  else root.RailPassengers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
