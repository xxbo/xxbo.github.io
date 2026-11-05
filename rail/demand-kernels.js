/* Transport/object compatibility only. Numerical model kernels execute in Rust/WASM. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./routing-wasm') : root.RailRouting;
  const PURPOSES = ['work', 'shopping', 'leisure'];
  const VOT = {
    work: 40,
    shopping: 25,
    leisure: 20
  };

  function ipf(seed, rows, cols, n, maxIterations = 160, tolerance = 1e-6) {
    if (!Number.isInteger(n) || n < 0 || seed.length !== n * n || rows.length !== n || cols.length !== n) throw Error('OD矩阵尺寸无效');
    const input = new Float64Array(3 + n * n + n * 2);
    input.set([n, maxIterations, tolerance]);
    input.set(seed, 3);
    input.set(rows, 3 + n * n);
    input.set(cols, 3 + n * n + n);
    const out = Core.kernel('demand_ipf', input);
    return {
      matrix: out.subarray(2),
      error: out[0],
      iterations: out[1]
    };
  }

  function distribution(zones, city, budgets) {
    const n = zones.length,
      effective = !!city.metadata?.effectiveConnections;
    const input = new Float64Array(6 + n * 8);
    input.set([n, effective ? 1 : 0, city.totals.people, ...PURPOSES.map((p, i) => effective ? budgets[p].outbound : city.totals.people * [.52, .16, .12][i])]);
    for (let i = 0; i < n; i++) {
      const z = zones[i];
      input.set([z.x, z.y, z.area, z.people, z.jobs, z.shops, z.industry, z.leisure], 6 + i * 8);
    }
    const out = Core.kernel('demand_distribution', input),
      matrices = {},
      diagnostics = {
        ipfError: out[0],
        ipfIterations: out[1]
      };
    PURPOSES.forEach((p, i) => {
      matrices[p] = out.subarray(5 + i * n * n, 5 + (i + 1) * n * n);
      if (effective) budgets[p].matched = out[2 + i];
    });
    if (effective) diagnostics.activityBudgets = budgets;
    return {
      matrices,
      diagnostics
    };
  }

  function modeShare({
    purpose,
    minutes,
    access,
    accessCost = 1.7 * access,
    fare,
    km,
    availability = {}
  }) {
    return Core.modeKernel([VOT[purpose] || 25, minutes, accessCost, fare, km,
      availability.walk ?? (km <= 5 ? 1 : 0), availability.bike ?? (km <= 12 ? .35 : 0),
      availability.car ?? .5, availability.bus ?? 1, availability.rail ?? 1
    ]);
  }
  let strategyInput = new Float64Array(128);

  function readStrategy(out, candidates) {
    const routes = [];
    for (let i = 0; i < out[2]; i++) {
      const at = 3 + i * 4;
      routes.push({
        path: candidates[out[at]],
        cost: out[at + 1],
        freq: out[at + 2],
        share: out[at + 3]
      });
    }
    return {
      expected: out[0],
      wait: out[1],
      routes
    };
  }

  function strategy(candidates, purpose, valueOverride = null) {
    const length = 2 + candidates.length * 5;
    if (strategyInput.length < length) strategyInput = new Float64Array(length);
    const keys = new Map();
    let at = 2;
    candidates.forEach((path, index) => {
      if (!path?.edges.length) return;
      const first = path.edges[0],
        key = first.service + '|' + first.dir;
      if (!keys.has(key)) keys.set(key, keys.size);
      strategyInput[at++] = keys.get(key);
      strategyInput[at++] = path.minutes;
      strategyInput[at++] = path.fare;
      strategyInput[at++] = first.headway;
      strategyInput[at++] = index;
    });
    strategyInput[0] = (at - 2) / 5;
    strategyInput[1] = valueOverride || VOT[purpose] || 25;
    const result = Core.kernel('demand_strategy', strategyInput.subarray(0, at), readStrategy, candidates);
    // Only retain a small scratch buffer after unusually large public API calls.
    if (strategyInput.byteLength > 65536) strategyInput = new Float64Array(128);
    return result;
  }

  function capacity(s, base, plan, X, R) {
    const tracks = [],
      trackIds = new Map(),
      lines = [],
      lineIds = new Map(),
      values = [];

    function intern(map, list, id) {
      if (!map.has(id)) {
        map.set(id, list.length);
        list.push(id);
      }
      return map.get(id);
    }
    for (const flow of base.flows) {
      const ids = flow.path.edges.flatMap(e => e.tracks || [e.track]);
      const own = [...new Set(flow.path.edges.flatMap(e => e.parts.map(p => p.line)))];
      values.push(flow.trips, ids.length);
      for (const id of ids) values.push(intern(trackIds, tracks, id));
      values.push(own.length);
      for (const id of own) values.push(intern(lineIds, lines, id));
    }
    for (const track of s.tracks) intern(trackIds, tracks, track.id);
    const runs = [];
    for (const line of plan.services) {
      const ids = [...new Set(line.trackIds)].map(id => trackIds.get(id));
      runs.push(X.headway(plan, line), R.capacity(line), ids.length, ...ids);
    }
    const input = new Float64Array(4 + runs.length + values.length);
    input.set([tracks.length, base.flows.length, lines.length, plan.services.length]);
    input.set(runs, 4);
    input.set(values, 4 + runs.length);
    const out = Core.kernel('demand_capacity', input);
    base.riders = out[0];
    base.unserved = out[1];
    base.trackFlow = {};
    base.trackLoad = {};
    base.serviceFlow = {};
    tracks.forEach((id, i) => {
      if (out[2 + i * 3]) base.trackFlow[id] = out[3 + i * 3];
    });
    for (const t of s.tracks) base.trackLoad[t.id] = out[4 + trackIds.get(t.id) * 3];
    let at = 2 + tracks.length * 3;
    base.flows.forEach((flow, i) => {
      flow.trips = out[at + i];
    });
    at += base.flows.length;
    lines.forEach((id, i) => {
      if (out[at + i * 2]) base.serviceFlow[id] = out[at + i * 2 + 1];
    });
  }
  function budgets(city) {
    const out=Core.kernel('world_policy',[0,...['people','jobs','shops','industry','leisure'].map(k=>city.totals[k]||0)]);
    return Object.fromEntries(PURPOSES.map((p,i)=>[p,{nominal:out[i*3],capacity:out[i*3+1],outbound:out[i*3+2]}]));
  }
  function visitorBudget(city,total) {
    const out=Core.kernel('world_policy',[1,city.totals.shops||0,city.totals.leisure||0,city.totals.jobs||0,total]);
    return {capacity:out[0],scale:out[1]};
  }
  function capRows(matrix,rows,n) {
    const out=Core.kernel('world_policy',[2,n,...rows,...matrix]);
    for(let i=0;i<out.length;i++)matrix[i]=out[i];
    return matrix;
  }
  function reserveExternal(allocations,zones,reachable) {
    const values=[3,allocations.length,zones.length,...zones.map(z=>z.people)];
    for(const a of allocations)for(let i=0;i<zones.length;i++)values.push(a.staffTrips[i],a.local[i],reachable(a,i)?1:0);
    const out=Core.kernel('world_policy',values);let at=0;
    for(const a of allocations)for(let i=0;i<zones.length;i++){a.staffTrips[i]=out[at++];a.local[i]=out[at++];}
  }
  function hubShare(reference,args,kind) {
    return Core.kernel('world_policy',[4,reference,args.minutes,args.access,args.fare,args.km,kind?.startsWith('staff')?1:0])[0];
  }
  const api = {
    budgets, visitorBudget, capRows, reserveExternal, hubShare,
    ipf,
    distribution,
    modeShare,
    strategy,
    capacity,
    status: Core.status
  };
  if (node) module.exports = api;
  else root.RailDemandKernels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);