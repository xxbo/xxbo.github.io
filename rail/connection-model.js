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

  const kernels = () => typeof module !== 'undefined' && module.exports ? require('./demand-kernels') : root.RailDemandKernels;
  const budgets = city => kernels().budgets(city);
  const visitorBudget = (city,total) => kernels().visitorBudget(city,total);
  const capRows = (matrix,rows,n) => kernels().capRows(matrix,rows,n);
  const reserveExternal = (allocations,zones,reachable) => kernels().reserveExternal(allocations,zones,reachable);

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
