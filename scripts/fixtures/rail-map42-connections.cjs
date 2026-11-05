/* Frozen MAP42 oracle; tests only, excluded from deployment. */
/* Destination-limited activity budgets. Parameters are explicit game assumptions. */
(function(root) {
  'use strict';
  const VERSION = 36,
    CAPACITY = {
      work: .95,
      shopping: 1.8,
      leisure: 1.5
    },
    FIELDS = {
      work: 'jobs',
      shopping: 'shops',
      leisure: 'leisure'
    },
    RATES = {
      work: .52,
      shopping: .16,
      leisure: .12
    };

  function budgets(city) {
    const out = {};
    for (const purpose of Object.keys(FIELDS)) {
      const nominal = Math.max(0, city.totals.people * RATES[purpose]),
        capacity = Math.max(0, (city.totals[FIELDS[purpose]] || 0) * CAPACITY[purpose]);
      out[purpose] = {
        nominal,
        capacity,
        outbound: Math.min(nominal, capacity)
      };
    }
    return out;
  }
  // IPF's final column scaling can slightly exceed a row target at finite iterations.
  // Downscale only, so neither origin production nor destination attraction is exceeded.
  function capRows(matrix, rows, n) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += matrix[i * n + j];
      if (sum > rows[i] && sum > 0) {
        const ratio = rows[i] / sum;
        for (let j = 0; j < n; j++) matrix[i * n + j] *= ratio;
      }
    }
    return matrix;
  }

  function visitorBudget(city, total) {
    const capacity = Math.max(0, (city.totals.shops || 0) * .8 + (city.totals.leisure || 0) * .65 + (city
      .totals.jobs || 0) * .12);
    return {
      capacity,
      scale: total > 0 ? Math.min(1, capacity / total) : 1
    };
  }
  // Reserve only reachable external trips; leave room for local city life.
  function reserveExternal(allocations, zones, reachable) {
    const staff = new Float64Array(zones.length),
      local = new Float64Array(zones.length);
    for (const a of allocations)
      for (let i = 0; i < zones.length; i++) {
        if (!reachable(a, i)) {
          a.staffTrips[i] = 0;
          a.local[i] = 0;
        }
        staff[i] += a.staffTrips[i];
        local[i] += a.local[i];
      }
    for (const a of allocations)
      for (let i = 0; i < zones.length; i++) {
        a.staffTrips[i] *= staff[i] ? Math.min(1, zones[i].people * .52 * .25 / staff[i]) : 0;
        a.local[i] *= local[i] ? Math.min(1, zones[i].people * .12 * .25 / local[i]) : 0;
      }
  }

  function summarize(s, model) {
    const stations = model.catchment.stations,
      rows = Object.fromEntries(s.services.map(l => {
        const stopIds = [...new Set(l.stops)],
          local = {
            people: 0,
            jobs: 0,
            shops: 0,
            leisure: 0
          };
        for (const id of stopIds) {
          const st = stations[id];
          if (st)
            for (const k of Object.keys(local)) local[k] += st[k] || 0;
        }
        return [l.id, {
          ...local,
          purposes: {
            work: 0,
            shopping: 0,
            leisure: 0
          },
          demand: 0,
          hub: 0,
          transfers: 0,
          shared: 0,
          travel: 0,
          homes: new Set(),
          destinations: new Set()
        }];
      }));
    for (const flow of model.flows) {
      const amount = flow.demandTrips ?? flow.trips,
        ids = new Set(flow.path.edges.flatMap(e => (e.parts || []).map(p => p.line)));
      for (const id of ids) {
        const row = rows[id];
        if (!row) continue;
        row.demand += amount;
        row.purposes[flow.purpose] = (row.purposes[flow.purpose] || 0) + amount;
        row.travel += amount * (flow.path.minutes + flow.walk);
        if (flow.hub) row.hub += amount;
        if (flow.path.transfers) row.transfers += amount;
        if (flow.routeOptions > 1) row.shared += amount;
        row.homes.add(flow.back ? flow.to : flow.from);
        if (flow.purpose === 'work' && !flow.externalKind?.startsWith('staff')) row.destinations.add(flow
          .back ? flow.from : flow.to);
      }
    }
    for (const row of Object.values(rows)) {
      row.reachableJobs = [...row.destinations].reduce((v, id) => v + (stations[id]?.jobs || 0), 0);
      row.reachableHomes = [...row.homes].reduce((v, id) => v + (stations[id]?.people || 0), 0);
      row.minutes = row.demand ? row.travel / row.demand : 0;
      row.sharedShare = row.demand ? row.shared / row.demand : 0;
      row.transferShare = row.demand ? row.transfers / row.demand : 0;
      delete row.homes;
      delete row.destinations;
      delete row.travel;
    }
    return rows;
  }
  const api = {
    VERSION,
    CAPACITY,
    FIELDS,
    RATES,
    budgets,
    capRows,
    visitorBudget,
    reserveExternal,
    summarize
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailConnections = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
