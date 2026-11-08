/* Numeric transport and object identity only. Simulation decisions execute in Rust. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./routing-wasm') : root.RailRouting;
  const X = node ? require('./service-plan') : root.RailServicePlan;
  const R = node ? require('./engine') : root.RailSim;
  const B = node ? require('./operations') : root.RailOperations;
  const F = node ? require('./fleet') : root.RailFleet;
  const catalogs = new WeakMap();

  function call(values) {
    return Core.kernel('simulation_run', values);
  }

  function intern(map, id) {
    if (!map.has(id)) map.set(id, map.size);
    return map.get(id);
  }

  function dispatchFrame(rt, s, index) {
    if (!s.services.some(l => X.directions(l).some(dir => {
        const d = rt.departures[l.id + '|' + dir];
        return d && !(rt.minute + 1e-8 < d.next);
      }))) return null;
    const services = new Map(),
      parents = new Map(),
      records = [],
      context = [],
      trains = [];
    for (const t of rt.trains) trains.push(intern(services, t.service), intern(parents, t
      .parentLine || t.service), t.dir);
    for (const l of s.services)
      for (const dir of X.directions(l)) {
        const d = rt.departures[l.id + '|' + dir],
          base = index.base.get(l.parentLine || l.id);
        const service = intern(services, l.id),
          parent = intern(parents, l.parentLine || l.id);
        // Defer expensive geometric metadata for departures the native scheduler will skip.
        const due = d && !(rt.minute + 1e-8 < d.next),
          h = due ? R.effectiveHeadway(s, l) : 0;
        records.push(service, parent, dir, d ? 1 : 0, d?.next || 0, due ? (d.headway || h) : 0, l
          .open ?? 0, l.close ?? 1440, l.fleet,
          base?.fleetManaged ? 1 : 0, due && base?.fleetManaged ? F.planned(base, rt.minute) :
          0,
          l.stops[0] === l.stops.at(-1) ? 1 : 0, X.directions(l).length, due ? B.routeTime(s,
            l) : 0, h);
        context.push({
          l,
          dir,
          d
        });
      }
    if (!context.some(({
        d
      }) => d && !(rt.minute + 1e-8 < d.next))) return null;
    const input = new Float64Array(6 + trains.length + records.length);
    input.set([3, rt.minute, services.size, parents.size, rt.trains.length, context.length]);
    input.set(trains, 6);
    input.set(records, 6 + trains.length);
    return {input,context};
  }
  function dispatch(rt,s,index) {
    const frame=dispatchFrame(rt,s,index);
    return frame?projectDispatch(frame,call(frame.input)):[];
  }
  function projectDispatch(frame,result) {
    const context=frame.context;
    for (let i = 0; i < context.length; i++) {
      context[i].action = result[i * 2];
      context[i].next = result[i * 2 + 1];
    }
    return context;
  }

  const motionStates = new WeakMap(),
    trainLayouts = new WeakMap(),
    runLayouts = new WeakMap();
  let motionSerial = 0;

  function motion(rt, s, index, track, deferred = false) {
    if (!rt.trains.length) return {
      context: [],
      data: new Float64Array(0),
      input: new Float64Array([4, 0, rt.minute, B.SPACING, 1, 0, 0])
    };
    let cache = motionStates.get(rt);
    const reload = !cache || cache.plan !== s || cache.minute !== Math.floor(rt.minute) || Core
      .simulationToken() !== cache.token ||
      cache.context.length !== rt.trains.length || rt.trains.some((t, i) => cache.context[i].t !==
        t);
    let input;
    if (reload) {
      const token = cache?.token || ++motionSerial;
      const blocks = cache?.plan === s ? cache.blocks : new Map(),
        context = [],
        chunks = [],
        counts = new Map();
      let length = 0;
      for (const t of rt.trains) {
        const k = t.service + '|' + t.dir;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      for (const t of rt.trains) {
        const l = t.retiringRun || index.runs.get(t.service);
        let layout = trainLayouts.get(t);
        if (!layout || layout.plan !== s || layout.blocks !== blocks || layout.l !== l || layout
          .stops !== t.stops || layout.calls !== t.callStops || layout.tracks !== t.trackIds) {
          const data = new Array(20).fill(0);
          data[0] = l ? 1 : 0;
          data[3] = t.dir;
          data[4] = t.stops.length - 1;
          data[9] = t.loop ? 1 : 0;
          data[10] = t.retiringRun ? 1 : 0;
          data[18] = l?.cars || 0;
          data[19] = -1;
          data.push(t.trackIds.length);
          for (let i = 0; i < t.trackIds.length; i++) {
            const tr = l && track(rt, index, t, t.trackIds[i]);
            if (!tr) {
              data.push(0, -1);
              continue;
            }
            const from = t.stops[t.dir === 1 ? i : i + 1],
              block = tr.id + '|' + (from === tr.a ? 1 : -1);
            data.push(tr.km, intern(blocks, block));
          }
          const called = new Set(t.callStops);
          data.push(t.stops.length, ...t.stops.map(id => called.has(id) ? 1 : 0));
          layout = {
            plan: s,
            blocks,
            l,
            stops: t.stops,
            calls: t.callStops,
            tracks: t.trackIds,
            data: new Float64Array(data),
            context: {
              t,
              l
            }
          };
          trainLayouts.set(t, layout);
        }
        let run = l && runLayouts.get(l);
        if (l && (!run || run.plan !== s || run.minute !== Math.floor(rt.minute) || run.fleet !==
            l.fleet)) {
          run = {
            plan: s,
            minute: Math.floor(rt.minute),
            fleet: l.fleet,
            perDir: l.fleet / X.directions(l).length,
            open: B.isOpen(l, rt.minute) ? 1 : 0,
            dwell: t.loop ? X.loopDwell(s, l) : B.DWELL
          };
          runLayouts.set(l, run);
        }
        const data = layout.data;
        data[1] = t.status === 'moving' ? 1 : t.status === 'finished' ? 3 : 0;
        data[2] = t.index;
        data[5] = t.progress;
        data[6] = t.departedAt ?? 0;
        data[7] = t.arriveAt ?? 0;
        data[8] = t.ready ?? 0;
        data[11] = run?.open || 0;
        data[12] = run?.perDir || 0;
        data[13] = counts.get(t.service + '|' + t.dir) || 0;
        data[14] = run?.dwell || 0;
        chunks.push(data);
        length += data.length;
        context.push(layout.context);
      }
      input = new Float64Array(7 + blocks.size + length);
      input.set([4, token, rt.minute, B.SPACING, 1, blocks.size]);
      for (const [key, id] of blocks) input[6 + id] = rt.blocks[key] || 0;
      input[6 + blocks.size] = rt.trains.length;
      let at = 7 + blocks.size;
      for (const chunk of chunks) {
        input.set(chunk, at);
        at += chunk.length;
      }
      cache = {
        token,
        plan: s,
        minute: Math.floor(rt.minute),
        context,
        blocks,
        input: new Float64Array(6 + blocks.size)
      };
      cache.input.set([4, token, rt.minute, B.SPACING, 0, blocks.size]);
      motionStates.set(rt, cache);
    } else {
      input = cache.input;
      input[2] = rt.minute;
      for (const [key, id] of cache.blocks) input[6 + id] = rt.blocks[key] || 0;
    }
    return deferred ? {
      context: cache.context,
      input
    } : {
      context: cache.context,
      data: call(input)
    };
  }

  const deltaStates = new WeakMap();

  function incremental(rt, s, index, track, identity) {
    let c = deltaStates.get(rt),
      reset = !c || c.plan !== s || Core.simulationToken() !== c.token;
    if (reset) {
      c = {
        plan: s,
        token: Core.allocateToken(),
        blocks: new Map(),
        groups: new Map(),
        context: [],
        seen: new WeakSet(),
        minute: -1
      };
      deltaStates.set(rt, c);
    }
    const changed = c.context.length !== rt.trains.length || rt.trains.some((t, i) => c.context[i]
      .t !== t);
    const parameters = c.minute !== Math.floor(rt.minute),
      updates = [],
      chunks = [];
    let length = 0;
    for (const t of rt.trains) {
      if (!parameters && c.seen.has(t)) continue;
      const l = t.retiringRun || index.runs.get(t.service);
      let layout = trainLayouts.get(t);
      if (!layout || layout.plan !== s || layout.blocks !== c.blocks || layout.l !== l || layout
        .stops !== t.stops || layout.calls !== t.callStops || layout.tracks !== t.trackIds) {
        const a = new Array(20).fill(0);
        a[0] = l ? 1 : 0;
        a[3] = t.dir;
        a[4] = t.stops.length - 1;
        a[9] = +t.loop;
        a[10] = t.retiringRun ? 1 : 0;
        a[18] = l?.cars || 0;
        a[19] = -1;
        a.push(t.trackIds.length);
        for (let i = 0; i < t.trackIds.length; i++) {
          const tr = l && track(rt, index, t, t.trackIds[i]);
          if (!tr) {
            a.push(0, -1);
            continue;
          }
          const from = t.stops[t.dir === 1 ? i : i + 1],
            block = tr.id + '|' + (from === tr.a ? 1 : -1);
          a.push(tr.km, intern(c.blocks, block));
        }
        const calls = new Set(t.callStops);
        a.push(t.stops.length, ...t.stops.map(id => calls.has(id) ? 1 : 0));
        layout = {
          plan: s,
          blocks: c.blocks,
          l,
          stops: t.stops,
          calls: t.callStops,
          tracks: t.trackIds,
          data: new Float64Array(a),
          context: {
            t,
            l
          }
        };
        trainLayouts.set(t, layout);
      }
      let run = l && runLayouts.get(l);
      if (l && (!run || run.plan !== s || run.minute !== Math.floor(rt.minute) || run.fleet !== l
          .fleet)) {
        run = {
          plan: s,
          minute: Math.floor(rt.minute),
          fleet: l.fleet,
          perDir: l.fleet / X.directions(l).length,
          open: B.isOpen(l, rt.minute) ? 1 : 0,
          dwell: t.loop ? X.loopDwell(s, l) : B.DWELL
        };
        runLayouts.set(l, run);
      }
      const a = layout.data;
      a[1] = t.status === 'moving' ? 1 : t.status === 'finished' ? 3 : 0;
      a[2] = t.index;
      a[5] = t.progress;
      a[6] = t.departedAt ?? 0;
      a[7] = t.arriveAt ?? 0;
      a[8] = t.ready ?? 0;
      a[11] = run?.open || 0;
      a[12] = run?.perDir || 0;
      a[14] = run?.dwell || 0;
      updates.push([identity(t), intern(c.groups, t.service + '|' + t.dir)]);
      chunks.push(a);
      length += a.length + 2;
      c.seen.add(t);
    }
    if (changed || reset) c.context = rt.trains.map(t => trainLayouts.get(t).context);
    const count = changed || reset ? rt.trains.length : -1,
      input = new Float64Array(8 + c.blocks.size + (count < 0 ? 0 : count) + length);
    input.set([6, c.token, rt.minute, 2, +reset, c.blocks.size]);
    for (const [k, id] of c.blocks) input[6 + id] = rt.blocks[k] || 0;
    let at = 6 + c.blocks.size;
    input[at++] = count;
    if (count >= 0)
      for (const t of rt.trains) input[at++] = identity(t);
    input[at++] = updates.length;
    for (let i = 0; i < chunks.length; i++) {
      input.set(updates[i], at);
      at += 2;
      input.set(chunks[i], at);
      at += chunks[i].length;
    }
    c.minute = Math.floor(rt.minute);
    return {
      context: c.context,
      input
    };
  }

  function boarding(rt, t) {
    const k = t.service + '|' + t.dir + '|' + t.stops[t.index],
      q = rt.queues[k];
    if (!q) return {
      k,
      tokens: [],
      data: new Float64Array([0])
    };
    const tokens = Object.keys(q),
      input = new Float64Array(8 + tokens.length * 4);
    input.set([1, rt.minute, t.capacity, t.onboard, tokens.length, t.index, t.dir, t.loop ? 1 :
      0
    ]);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i],
        [journey, legIndex] = token.split(':').map(Number),
        leg = rt.defs[journey]?.legs[legIndex];
      input.set([q[token], rt.waitSince[k + '#' + token] ?? rt.minute, leg ? t.stops.indexOf(leg
        .to) : -1, leg && t.callStops.includes(leg.to) ? 1 : 0], 8 + i * 4);
    }
    return {
      k,
      tokens,
      data: call(input)
    };
  }

  function prepare(catalog) {
    let c = catalogs.get(catalog);
    if (c && c.length === catalog.length) return c;
    const factors = [],
      profiles = [],
      fm = new Map(),
      pm = new Map(),
      fi = new Uint32Array(catalog.length),
      pi = new Uint32Array(catalog.length);
    for (let i = 0; i < catalog.length; i++) {
      const j = catalog[i],
        ids = j.lineIds || Object.keys(j.path?.fares || {}),
        fk = JSON.stringify([ids, !!j.hub]),
        pk = JSON.stringify([j.purpose, j.back, j.externalKind || null]);
      if (!fm.has(fk)) {
        fm.set(fk, factors.length);
        factors.push(j);
      }
      if (!pm.has(pk)) {
        pm.set(pk, profiles.length);
        profiles.push(j);
      }
      fi[i] = fm.get(fk);
      pi[i] = pm.get(pk);
    }
    c = {
      length: catalog.length,
      factors,
      profiles,
      fi,
      pi,
      token: Core.allocateToken(),
      input: null
    };
    catalogs.set(catalog, c);
    return c;
  }

  function arrivals(catalog, factor, profile, remainder, rng) {
    const c = prepare(catalog),
      nf = c.factors.length,
      np = c.profiles.length,
      load = Core.samplingToken() !== c.token;
    if (!c.input) c.input = new Float64Array(8 + nf + np + catalog.length);
    const input = load ? new Float64Array(c.input.length + catalog.length * 2) : c.input;
    input.set([7, c.token, +load, catalog.length, nf, np, remainder, rng]);
    input.set(c.factors.map(factor), 8);
    input.set(c.profiles.map(profile), 8 + nf);
    for (let i = 0; i < catalog.length; i++) input[8 + nf + np + i] = catalog[i].daily;
    if (load)
      for (let i = 0; i < catalog.length; i++) {
        input[c.input.length + i * 2] = c.fi[i];
        input[c.input.length + i * 2 + 1] = c.pi[i];
      }
    const out = call(input);
    return {
      total: out[0],
      remainder: out[1],
      rng: out[2],
      events: out.subarray(4)
    };
  }

  function timedFrame(catalog, s, minute, dt, remainder, rng, integer = true) {
    const c = prepare(catalog),
      T = node ? require('./temporal-wasm') : root.RailTemporal;
    if (!c.timed) {
      const ids = new Map(),
        names = [];
      const intern = id => {
        if (!ids.has(id)) {
          ids.set(id, names.length);
          names.push(id);
        }
        return ids.get(id);
      };
      const meta = [];
      for (const j of c.factors) {
        const ls = j.lineIds || Object.keys(j.path?.fares || {});
        meta.push(+!!j.hub, ls.length, ...ls.map(intern));
      }
      for (const j of c.profiles) meta.push(T.purpose(j.purpose), +!!j.back, T.external(j
        .externalKind));
      c.timed = {
        token: Core.allocateToken(),
        names,
        meta: new Float64Array(meta),
        daily: new Float64Array(catalog.length),
        input: new Float64Array(13 + names.length * 4)
      };
    }
    const t = c.timed,
      load = Core.samplingToken() !== t.token,
      q = s.ridership;
    const changes = [];
    for (let i = 0; i < catalog.length; i++) {
      const daily = catalog[i].daily;
      if (load || !Object.is(t.daily[i], daily)) {
        if (!load) changes.push(i, daily);
        t.daily[i] = daily;
      }
    }
    const input = new Float64Array(t.input.length + (load ? catalog.length + t.meta.length +
      catalog.length * 2 : 1 + changes.length));
    input.set([9, t.token, +load, catalog.length, c.factors.length, c.profiles.length, remainder,
      rng, minute, dt, +integer, q ? (q.model === 22 ? 22 : 1) : 0, t.names.length
    ]);
    let at = 13;
    for (const id of t.names) {
      const r = q?.lines[id];
      input.set([r ? 1 : 0, r?.satisfaction ?? .7, Number(r?.awareness), Number(r?.trust)], at);
      at += 4;
    }
    if (load) {
      input.set(t.daily, at);
      at += catalog.length;
      input.set(t.meta, at);
      at += t.meta.length;
      for (let i = 0; i < catalog.length; i++) {
        input[at + i * 2] = c.fi[i];
        input[at + i * 2 + 1] = c.pi[i];
      }
    } else {
      input[at++] = changes.length / 2;
      input.set(changes, at);
    }
    return {input,context:{names:t.names}};
  }
  function timedArrivals(...args) {
    const frame=timedFrame(...args);
    return projectArrivals(call(frame.input));
  }
  function projectArrivals(out) {

    return {
      total: out[0],
      remainder: out[1],
      rng: out[2],
      events: out.subarray(4)
    };
  }
  const api = {
    timedArrivals,
    timedFrame,
    projectArrivals,
    dispatchFrame,
    projectDispatch,
    incremental,
    dispatch,
    motion,
    boarding,
    arrivals,
    status: Core.status
  };
  if (node) module.exports = api;
  else root.RailSimulation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
