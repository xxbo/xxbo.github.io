/* Time-rule metadata adapter. Curves, phase policy and allocation arithmetic execute in Rust. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./rail-map50-routing-wasm.cjs') : root.RailRouting;
  const contexts = new Map(),
    plans = new WeakMap(),
    allocations = new WeakMap();
  const call = a => Core.kernel('temporal_run', a);
  const purpose = p => p === 'work' ? 0 : p === 'shopping' ? 1 : 2;

  function external(kind) {
    if (kind?.startsWith('staff')) return kind === 'staff-homebound' ? 1 : 2;
    return !kind ? 0 : kind === 'local-departure' ? 3 : kind === 'visitor-return' ? 4 : 5;
  }

  let lastMinute, lastContext;

  function context(minute) {
    if (lastContext && Object.is(lastMinute, minute)) return lastContext;
    // All rule changes occur at integral minutes. Bound the view-only coefficient cache.
    const key = Math.floor(((minute % 1440) + 1440) % 1440);
    let v = contexts.get(key);
    if (!v) {
      v = call([1, 0, minute]);
      contexts.set(key, v);
      if (contexts.size > 16) contexts.delete(contexts.keys().next().value);
    }
    lastMinute = minute;
    lastContext = v;
    return v;
  }
  const peak = minute => !!context(minute)[1];

  function profile(p, back, minute, kind = null) {
    return context(minute)[2 + (purpose(p) * 2 + (back ? 1 : 0)) * 6 + external(kind)];
  }

  function config(l) {
    const d = l.fleetManaged ? l.dispatch : null;
    return [!!l.fleetManaged, d?.mode === 'auto', d?.manual, d?.offPeak, d?.peak, l.fleet];
  }
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  function encode(c, weights) {
    return [1, 1, +c[0], +c[1], Number(c[2]), Number(c[3]), Number(c[4]), Number(c[5]), weights
      .length, ...weights
    ];
  }

  function planned(l, minute) {
    const d = l.fleetManaged ? l.dispatch : null;
    let p = plans.get(l);
    if (!p || p.managed !== l.fleetManaged || p.fleet !== l.fleet || p.mode !== d?.mode || p
      .manual !== d?.manual || p.offPeak !== d?.offPeak || p.high !== d?.peak) {
      p = {
        managed: l.fleetManaged,
        fleet: l.fleet,
        mode: d?.mode,
        manual: d?.manual,
        offPeak: d?.offPeak,
        high: d?.peak,
        values: call(encode(config(l), []))
      };
      plans.set(l, p);
    }
    return p.values[l.fleetManaged && peak(minute) ? 2 : 1];
  }

  function allocate(l, minute) {
    const cfg = config(l),
      weights = (l.patterns || [{
        fleet: l.fleet
      }]).map(p => p.fleet);
    let p = allocations.get(l);
    if (!p || !same(p.cfg, cfg) || !same(p.weights, weights)) {
      p = {
        cfg,
        weights,
        values: call(encode(cfg, weights))
      };
      allocations.set(l, p);
    }
    const at = 4 + (peak(minute) ? weights.length : 0);
    return Array.from(p.values.subarray(at, at + weights.length));
  }

  function refreshFleet(rt) {
    const s = rt.plan,
      X = node ? require('./rail-map50-service-plan.cjs') : root.RailServicePlan;
    const bases = new Map(s.baseLines?.map(l => [l.id, l]) || []);
    const runs = s.services.filter(l => l.fleetManaged);
    if (!runs.length) return;
    const input = [1, 2, rt.minute, +(s.routeModel === 9), runs.length],
      contexts = [];
    for (const l of runs) {
      const base = bases.get(l.parentLine),
        cfg = config(base),
        weights = (base.patterns || [{
          fleet: base.fleet
        }]).map(p => p.fleet);
      input.push(...encode(cfg, weights).slice(2));
      const dirs = X.directions(l),
        ds = dirs.map(dir => rt.departures[l.id + '|' + dir]);
      const duration = s.routeModel === 9 ? X.duration(s, l) : l.trackIds.reduce((m, id) => m + s
        .tracks.find(t => t.id === id).km / 48 * 60 + .6, 0) + 1;
      input.push(l.patternIndex, +(l.stops[0] === l.stops.at(-1)), dirs.length, duration, l
        .headway, ds.length);
      for (const d of ds) input.push(+!!d, d?.next ?? 0, d?.headway ?? 0, +(d?.lastRun != null), d
        ?.lastRun ?? 0);
      contexts.push({
        l,
        ds
      });
    }
    const data = call(input);
    let at = 2;
    for (const {
        l,
        ds
      }
      of contexts) {
      l.fleet = data[at++];
      const h = data[at++],
        n = data[at++];
      for (let i = 0; i < n; i++) {
        const changed = data[at++],
          next = data[at++];
        if (changed) {
          ds[i].next = next;
          ds[i].headway = h;
        }
      }
    }
  }
  const api = {
    peak,
    profile,
    planned,
    allocations: allocate,
    purpose,
    external,
    refreshFleet
  };
  if (node) module.exports = api;
  else root.RailTemporal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
