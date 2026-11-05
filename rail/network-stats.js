/* Forecast presentation only. No cached state, passenger generation or accounting writes. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const R = node ? require('./engine') : root.RailSim;
  const X = node ? require('./service-plan') : root.RailServicePlan;
  const Q = node ? require('./ridership') : root.RailRidership;
  const F = node ? require('./fleet') : root.RailFleet;
  const BAL = node ? require('./game-balance') : root.RailBalance;

  // The order of additions for each line/station matches the original per-line scan.
  // A cross-line edge may contain several parts for one line: count that line once.
  function aggregate(s, forecast, lines) {
    const totals = new Map(lines.map(line => [line.id, {
      riders: 0,
      revenue: 0,
      stations: Object.fromEntries([...new Set(line.stops)].map(id => [id, {
        board: 0,
        alight: 0
      }]))
    }]));
    for (const flow of forecast.flows) {
      const trips = flow.trips * Q.factor(s, flow);
      for (const [id, fare] of Object.entries(flow.path.fares || {})) {
        const row = totals.get(id);
        if (row) row.revenue += trips * (fare || 0);
      }
      const used = new Set();
      const edges = flow.path.edges;
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const origin = i ? edges[i - 1].to : flow.from;
        for (const id of new Set((edge.parts || []).map(part => part.line))) {
          const row = totals.get(id);
          if (!row) continue;
          used.add(id);
          if (edges[i - 1]?.service !== edge.service && row.stations[origin]) row.stations[origin].board +=
            trips;
          if (edges[i + 1]?.service !== edge.service && row.stations[edge.to]) row.stations[edge.to]
            .alight += trips;
        }
      }
      for (const id of used) totals.get(id).riders += trips;
    }
    return totals;
  }

  function runsFor(s) {
    const byLine = new Map();
    for (const run of X.expand(s).services) {
      if (!byLine.has(run.parentLine)) byLine.set(run.parentLine, []);
      byLine.get(run.parentLine).push(run);
    }
    return byLine;
  }

  function finish(s, l, totals, runsByLine) {
    const {
      riders,
      revenue,
      stations
    } = totals;
    const runs = runsByLine.get(l.id) || [],
      km = R.serviceKm(s, l),
      hours = (l.close - l.open) / 60,
      departures = runs.reduce((v, r) => v + hours * 60 / X.headway(s, r) * X.directions(r).length, 0),
      cost = runs.reduce((v, r) => v + R.serviceKm(s, r) * hours * 60 / X.headway(s, r) * X.directions(r)
        .length * (180 + r.cars * 25), 0) + (l.fleetManaged ? F.planned(l, s.economy?.minute ?? 420) : l
        .fleet) * 18000 + km * 2200;
    return {
      riders,
      revenue,
      operatingGrant: revenue * BAL.GRANT_RATE,
      totalIncome: revenue * (1 + BAL.GRANT_RATE),
      cost: cost * BAL.OPERATING_FACTOR,
      km,
      headway: runs.length ? 1 / runs.reduce((v, r) => v + 1 / X.headway(s, r), 0) : l.headway,
      stations,
      capacity: R.capacity(l),
      fleet: l.fleet,
      cars: l.cars,
      hours,
      departures
    };
  }

  function line(s, forecast, id) {
    if (s.routeModel !== 9) return legacyLine(s, forecast, id);
    const target = s.services.find(line => line.id === id);
    if (!target) return null;
    return finish(s, target, aggregate(s, forecast, [target]).get(id), runsFor(s));
  }

  // Use this for lists: one forecast traversal and one service expansion per refresh.
  // Deliberately no long-lived cache: fares, satisfaction and dispatch can mutate in place.
  function all(s, forecast) {
    if (s.routeModel !== 9) return new Map(s.services.map(l => [l.id, legacyLine(s, forecast, l.id)]));
    const totals = aggregate(s, forecast, s.services);
    const runs = runsFor(s);
    return new Map(s.services.map(l => [l.id, finish(s, l, totals.get(l.id), runs)]));
  }

  function legacyLine(s, m, id) {
    const l = s.services.find(l => l.id === id);
    if (!l) return null;
    const factor = (l.close - l.open) / (18 * 60),
      stations = Object.fromEntries([...new Set(l.stops)].map(n => [n, {
        board: 0,
        alight: 0
      }]));
    let revenue = 0,
      riders = 0;
    for (const f of m.flows) {
      let from = f.from,
        length = 0,
        aboard = false,
        used = false;
      for (let i = 0; i < f.path.edges.length; i++) {
        const e = f.path.edges[i];
        if (e.service === id) {
          if (!aboard) {
            stations[from].board += f.trips * factor;
            riders += f.trips * factor;
            aboard = true;
          }
          length += e.km;
          used = true;
          if (f.path.edges[i + 1]?.service !== id) {
            stations[e.to].alight += f.trips * factor;
            aboard = false;
          }
        }
        from = e.to;
      }
      if (used) {
        revenue += f.trips * f.path.fare * length / f.path.km * factor;
      }
    }
    const km = R.serviceKm(s, l),
      headway = R.effectiveHeadway(s, l),
      hours = (l.close - l.open) / 60,
      departures = hours * 60 / headway * 2,
      vehicleCost = km * departures * (180 + l.cars * 25),
      cost = vehicleCost + (l.fleetManaged ? F.planned(l, s.economy?.minute ?? 420) : l.fleet) * 18000 +
      km * 2200;
    return {
      riders,
      revenue,
      operatingGrant: revenue * BAL.GRANT_RATE,
      totalIncome: revenue * (1 + BAL.GRANT_RATE),
      cost: cost * BAL.OPERATING_FACTOR,
      km,
      headway,
      stations,
      capacity: R.capacity(l),
      fleet: l.fleet,
      cars: l.cars,
      hours,
      departures
    };
  }

  const api = {
    line,
    all
  };
  if (node) module.exports = api;
  else root.RailNetworkStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
