/* Frozen MAP37 formulas used only as a refactoring oracle. Never loaded by the game. */
const R = require('../../rail/engine'),
  X = require('../../rail/service-plan'),
  Q = require('../../rail/ridership'),
  F = require('../../rail/fleet'),
  BAL = require('../../rail/game-balance');

function stats(s, m, id) {
  if (s.routeModel === 9) return stats9(s, m, id);
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
    cost = vehicleCost + (l.fleetManaged ? F.planned(l, s.economy?.minute ?? 420) : l.fleet) * 18000 + km *
    2200;
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

function stats9(s, m, id) {
  const l = s.services.find(l => l.id === id);
  if (!l) return null;
  const stations = Object.fromEntries([...new Set(l.stops)].map(n => [n, {
    board: 0,
    alight: 0
  }]));
  let riders = 0,
    revenue = 0;
  for (const f of m.flows) {
    const trips = f.trips * Q.factor(s, f);
    revenue += trips * (f.path.fares?.[id] || 0);
    const relevant = f.path.edges.filter(e => e.parts?.some(p => p.line === id));
    if (!relevant.length) continue;
    riders += trips;
    for (let i = 0; i < f.path.edges.length; i++) {
      const e = f.path.edges[i];
      if (!e.parts?.some(p => p.line === id)) continue;
      const origin = i ? f.path.edges[i - 1].to : f.from;
      if (f.path.edges[i - 1]?.service !== e.service && stations[origin]) stations[origin].board += trips;
      if (f.path.edges[i + 1]?.service !== e.service && stations[e.to]) stations[e.to].alight += trips;
    }
  }
  const runs = X.expand(s).services.filter(r => r.parentLine === id),
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

module.exports = stats;
