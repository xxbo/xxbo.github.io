/* Area-sampled access, purpose gravity/IPF, nested mode choice, frequency strategy assignment.
   All behavioural coefficients are game assumptions, not a calibrated Tokyo forecast. */
(function(root) {
  'use strict';
  const CACHE = typeof module !== 'undefined' && module.exports ? require('./bounded-cache') : root
    .RailBoundedCache;
  const node = typeof module !== 'undefined' && module.exports,
    R = node ? require('./engine') : root.RailSim,
    X = node ? require('./service-plan') : root.RailServicePlan,
    H = node ? require('./hubs') : root.RailHubs,
    K = node ? require('./connection-model') : root.RailConnections;
  const KD = node ? require('./demand-kernels') : root.RailDemandKernels;
  const BAL = node ? require('./game-balance') : root.RailBalance;
  const FIELDS = ['people', 'jobs', 'shops', 'industry', 'leisure'],
    WALK = .8,
    DETOUR = 1.25,
    SAMPLES = 4,
    ZONE = 80;
  const profiles = [{
    purpose: 'work',
    field: 'jobs',
    rate: .52,
    decay: 14
  }, {
    purpose: 'shopping',
    field: 'shops',
    rate: .16,
    decay: 5
  }, {
    purpose: 'leisure',
    field: 'leisure',
    rate: .12,
    decay: 10
  }];
  const ACCESS_WEIGHTS = Object.freeze({
    walk: 1.7,
    bike: 1.2,
    bus: 1.1
  });
  const exp = x => Math.exp(Math.max(-700, Math.min(700, x)));
  let fixed;

  function sample(c, fn) {
    for (let y = 0; y < SAMPLES; y++)
      for (let x = 0; x < SAMPLES; x++) fn({
        x: c.x + ((x + .5) / SAMPLES - .5) * c.w,
        y: c.y + ((y + .5) / SAMPLES - .5) * c.h
      }, 1 / (SAMPLES * SAMPLES));
  }

  function stationIndex(s, activeOnly = false) {
    const ids = [...new Set(X.expand(s).services.filter(l => !activeOnly || l.fleet > 0).flatMap(l => l
        .callStops || l.stops))],
      bins = new Map();
    for (const id of ids) {
      const n = s.nodes[id],
        k = Math.floor(n.x / 100) + ':' + Math.floor(n.y / 100);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(n);
    }
    return {
      ids,
      near(p) {
        const out = [],
          x = Math.floor(p.x / 100),
          y = Math.floor(p.y / 100);
        for (let a = x - 1; a <= x + 1; a++)
          for (let b = y - 1; b <= y + 1; b++) out.push(...(bins.get(a + ':' + b) || []));
        return out;
      }
    };
  }

  function choices(p, stations, feeders = true) {
    const candidates = [];
    for (const n of stations) {
      const km = R.distance(p, n) * DETOUR;
      let time, mode, availability = 1;
      if (km <= WALK) {
        time = km / 4.8 * 60;
        mode = 'walk';
      } else if (feeders && km <= 2.5) {
        time = 4 + km / 12 * 60;
        mode = 'bike';
        availability = .3;
      } else if (feeders && km <= 4) {
        time = 7 + km / 16 * 60;
        mode = 'bus';
        availability = .25;
      } else continue;
      candidates.push({
        id: n.id,
        km,
        time,
        mode,
        accessCost: time * ACCESS_WEIGHTS[mode],
        weight: exp(-.14 * time) * availability
      });
    }
    candidates.sort((a, b) => b.weight - a.weight);
    const selected = candidates.slice(0, 3),
      sum = selected.reduce((v, a) => v + a.weight, 0),
      coverage = selected.length ? 1 : 0;
    return selected.map(a => ({
      ...a,
      share: a.weight / sum * coverage
    }));
  }

  function assign(s, city) {
    const index = stationIndex(s, !!city.metadata?.effectiveConnections),
      stations = Object.fromEntries(index.ids.map(id => [id, {
        people: 0,
        jobs: 0,
        shops: 0,
        industry: 0,
        leisure: 0,
        walk: 0,
        cells: 0
      }])),
      mapping = new Map();
    let covered = 0,
      accessible = 0;
    for (const c of city.cells) {
      const near = index.near(c);
      if (!near.length) continue;
      const totals = new Map();
      sample(c, (p, w) => {
        const list = choices(p, near);
        for (const a of list) {
          const key = a.id + '|' + a.mode + '|' + Math.floor(a.time / 3);
          let t = totals.get(key);
          if (!t) totals.set(key, t = {
            id: a.id,
            mode: a.mode,
            share: 0,
            walk: 0,
            time: 0,
            accessCost: 0,
            x: 0,
            y: 0
          });
          t.x += p.x * a.share * w;
          t.y += p.y * a.share * w;
          t.share += a.share * w;
          t.walk += a.km * a.share * w;
          t.time += a.time * a.share * w;
          t.accessCost += a.accessCost * a.share * w;
        }
        const foot = choices(p, near, false);
        covered += c.people * w * foot.reduce((v, a) => v + a.share, 0);
        for (const a of foot) {
          const st = stations[a.id];
          for (const k of FIELDS) st[k] += c[k] * a.share * w;
          st.walk += a.km * c.people * a.share * w;
          st.cells += a.share * w;
        }
      });
      if (!totals.size) continue;
      const access = [...totals.values()].map(a => ({
        ...a,
        walk: a.walk / a.share,
        time: a.time / a.share,
        accessCost: a.accessCost / a.share,
        x: a.x / a.share,
        y: a.y / a.share
      }));
      mapping.set(c.id, {
        id: access.reduce((a, b) => a.share > b.share ? a : b).id,
        walk: access.reduce((v, a) => v + a.walk * a.share, 0),
        access
      });
      accessible += c.people * access.reduce((v, a) => v + a.share, 0);
    }
    for (const st of Object.values(stations)) st.walk = st.people ? st.walk / st.people : 0;
    return {
      stations,
      mapping,
      covered,
      accessible,
      total: city.totals.people
    };
  }

  function local(city, p, radius = .8) {
    const out = {
      people: 0,
      jobs: 0,
      shops: 0,
      industry: 0,
      leisure: 0,
      cells: 0,
      area: Math.PI * radius * radius,
      factory: 0,
      surveyArea: 0,
      populationArea: 0
    };
    for (const c of city.cells) {
      if (R.distance(p, c) * DETOUR > radius + 1.5) continue;
      let share = 0;
      sample(c, q => {
        if (R.distance(p, q) * DETOUR <= radius) share += 1 / (SAMPLES * SAMPLES);
      });
      if (!share) continue;
      for (const k of [...FIELDS, 'factory']) out[k] += c[k] * share;
      out.cells += share;
      out.surveyArea += c.survey * c.area * share;
      if (c.populationValid) out.populationArea += c.area * share;
    }
    return out;
  }

  const ipf = KD.ipf,
    modeShare = KD.modeShare,
    strategy = KD.strategy;

  function distribution(city) {
    const ZONE = city.metadata?.demandZoneUnits || 80;
    if (fixed && fixed.city === city) return fixed;
    const map = new Map();
    for (const c of city.cells) {
      const key = Math.floor(c.x / ZONE) + ':' + Math.floor(c.y / ZONE);
      let z = map.get(key);
      if (!z) map.set(key, z = {
        key,
        x: 0,
        y: 0,
        count: 0,
        area: 0,
        people: 0,
        jobs: 0,
        shops: 0,
        industry: 0,
        leisure: 0,
        cells: []
      });
      z.x += c.x;
      z.y += c.y;
      z.count++;
      z.area += c.area;
      for (const k of FIELDS) z[k] += c[k];
      z.cells.push(c);
    }
    const zones = [...map.values()];
    zones.forEach(z => {
      z.x /= z.count;
      z.y /= z.count;
    });
    const n = zones.length,
      effective = !!city.metadata?.effectiveConnections,
      budgets = effective ? K.budgets(city) : null;
    const {
      matrices,
      diagnostics
    } = KD.distribution(zones, city, budgets);
    fixed = {
      city,
      zones,
      matrices,
      diagnostics
    };
    return fixed;
  }

  // Nested logit: walk/bike in active nest, car/bus/rail in motorized nest; stable log-sums.
  // Availability-weighted nests. Baseline bus includes access, wait and road detour;
  // it is not an express stop-to-stop service parallel to every player line.
  const MODE_ASSUMPTIONS = Object.freeze({
    carAvailability: .5,
    bikeAvailability: .35,
    busAccessMinutes: 8,
    busWaitMinutes: 6,
    busDetour: 1.35,
    carParkingMinutes: 8,
    timeSensitivity: .055,
    nestScale: .7
  });

  function evaluate(s, city) {
    const hubList = H.forRegion(s.region);
    const started = Date.now(),
      effective = !!city.metadata?.effectiveConnections,
      activityBudgets = effective ? K.budgets(city) : null,
      catchment = assign(s, city),
      totalTrips = effective ? Object.values(activityBudgets).reduce((v, b) => v + b.outbound * 2, 0) : city
      .totals.people * 1.6,
      base = {
        city: true,
        flows: [],
        trackFlow: {},
        trackLoad: {},
        serviceFlow: {},
        riders: 0,
        unserved: 0,
        totalTrips,
        uncoveredTrips: totalTrips,
        purposeTotals: {
          work: 0,
          shopping: 0,
          leisure: 0
        },
        catchment,
        population: city.totals.people,
        jobs: city.totals.jobs,
        hubStats: {},
        connectionModel: effective ? 36 : null,
        diagnostics: {
          model: effective ? 'effective-connections-v36' : s.urban ? 'transit-urban-growth-v19' : 'hub-corridor-progression-v17',
          ...(effective ? {
            activityBudgets
          } : {})
        }
      };
    for (const h of hubList) base.hubStats[h.id] = {
      ...H.envelope(h),
      railReference: H.access(h).railReference,
      referenceTarget: H.envelope(h).landside * H.access(h).railReference,
      marketActivation: s.urban ? 0 : 1,
      riders: 0,
      arrivals: 0,
      departures: 0,
      staffRiders: 0,
      passengerRiders: 0,
      connections: []
    };
    if (!s.services.length) {
      if (effective) base.lineConnections = K.summarize(s, base);
      return base;
    }
    const {
      zones,
      matrices,
      diagnostics
    } = distribution(city), n = zones.length, adj = X.network(s), cache = CACHE.create({
        limit: 24,
        maxWeight: 60000,
        weight: trees => trees.reduce((n, tree) => n + tree.memoryWeight, 0)
      }), grouped = new Map(),
      active = [], zoneAccess = zones.map((z, i) => {
        const maps = Object.fromEntries(FIELDS.map(k => [k, new Map()]));
        for (const c of z.cells)
          for (const a of catchment.mapping.get(c.id)?.access || [])
            for (const k of FIELDS) {
              const key = a.id + '|' + a.mode + '|' + Math.floor(a.time / 3);
              let g = maps[k].get(key);
              if (!g) maps[k].set(key, g = {
                id: a.id,
                mode: a.mode,
                mass: 0,
                time: 0,
                accessCost: 0,
                x: 0,
                y: 0
              });
              const mass = c[k] * a.share;
              g.mass += mass;
              g.time += mass * a.time;
              g.accessCost += mass * a.accessCost;
              g.x += mass * a.x;
              g.y += mass * a.y;
            }
        const result = {};
        for (const k of FIELDS) result[k] = [...maps[k].values()].filter(a => a.mass > 0).map(a => ({
          id: a.id,
          mode: a.mode,
          share: a.mass / Math.max(1, z[k]),
          time: a.time / a.mass,
          accessCost: a.accessCost / a.mass,
          x: a.x / a.mass,
          y: a.y / a.mass
        }));
        if (result.people.length || result.jobs.length || result.shops.length || result.leisure.length)
          active.push(i);
        return result;
      });
    const staffBudget = new Float64Array(n),
      localBudget = new Float64Array(n),
      hubAlloc = [];
    for (const h of hubList) {
      const rawEnv = H.envelope(h),
        market = zones.reduce((v, z) => v + (z.people + z.jobs * .7) * exp(-R.distance(z, h) / 35), 0),
        activation = s.urban ? (1 - Math.exp(-market / 40000)) * (.2 + .8 * (1 - Math.exp(-s.urban.step /
          32))) : 1,
        env = {
          ...rawEnv,
          visitorArrivals: rawEnv.visitorArrivals * activation,
          visitorReturns: rawEnv.visitorReturns * activation,
          localDepartures: rawEnv.localDepartures * activation,
          localReturns: rawEnv.localReturns * activation
        },
        visitor = zones.map(z => (z.jobs * .35 + z.leisure) * exp(-R.distance(z, h) / 35)),
        residents = zones.map(z => z.people * exp(-R.distance(z, h) / 45)),
        vs = visitor.reduce((a, b) => a + b, 0),
        rs = residents.reduce((a, b) => a + b, 0),
        local = residents.map((a, i) => {
          const q = rs ? env.localDepartures * a / rs : 0;
          localBudget[i] += q;
          return q;
        });
      const staff = zones.map(z => z.people * exp(-R.distance(z, h) / 30)),
        ss = staff.reduce((a, b) => a + b, 0),
        workers = H.access(h).staff || 0,
        staffTrips = staff.map((v, i) => {
          const trips = ss ? workers * .8 * v / ss : 0;
          staffBudget[i] += trips;
          return trips;
        });
      base.hubStats[h.id].marketActivation = activation;
      hubAlloc.push({
        h,
        env,
        visitor: visitor.map(a => vs ? a / vs : 0),
        local,
        staffTrips
      });
    }
    if (effective) {
      const budget = K.visitorBudget(city, hubAlloc.reduce((v, a) => v + a.env.visitorArrivals, 0));
      for (const a of hubAlloc) {
        a.env.visitorArrivals *= budget.scale;
        a.env.visitorReturns *= budget.scale;
        Object.assign(base.hubStats[a.h.id], {
          visitorDestinationScale: budget.scale,
          visitorDestinationCapacity: budget.capacity
        });
      }
    }
    const components = s.nodes.map((_, i) => i),
      find = i => {
        while (components[i] !== i) {
          components[i] = components[components[i]];
          i = components[i];
        }
        return i;
      };
    for (let i = 0; i < adj.length; i++)
      for (const e of adj[i]) components[find(e.to)] = find(i);
    const component = s.nodes.map((_, i) => find(i));
    if (effective) {
      const idx = stationIndex(s, effective),
        connections = new Map(hubAlloc.map(a => [a.h.id, choices(a.h, idx.near(a.h), false)]));
      K.reserveExternal(hubAlloc, zones, (a, i) => zoneAccess[i].people.some(origin => connections.get(a.h
        .id).some(destination => origin.id !== destination.id && component[origin.id] === component[
        destination.id])));
      staffBudget.fill(0);
      localBudget.fill(0);
      for (const a of hubAlloc)
        for (let i = 0; i < n; i++) {
          staffBudget[i] += a.staffTrips[i];
          localBudget[i] += a.local[i];
        }
    }

    function add(a, b, purpose, back, daily, km, hub = null, kind = null) {
      if (component[a.id] !== component[b.id] || a.id === b.id || daily < 1e-10) return;
      const key = [a.id, b.id, purpose, back, hub || '', kind || '', Math.floor((a.time + b.time) / 3), Math
        .floor(km / 2)
      ].join('|');
      let g = grouped.get(key);
      if (!g) grouped.set(key, g = {
        from: a.id,
        to: b.id,
        purpose,
        back,
        people: 0,
        access: 0,
        accessCost: 0,
        km: 0,
        hub,
        externalKind: kind
      });
      const amount = daily * a.share * b.share;
      g.people += amount;
      g.access += amount * (a.time + b.time);
      g.accessCost += amount * (a.accessCost + b.accessCost);
      g.km += amount * km;
    }
    for (const i of active)
      for (const j of active)
        for (const p of profiles) {
          let daily = matrices[p.purpose][i * n + j];
          if (p.purpose === 'work') daily *= Math.max(0, 1 - staffBudget[i] / Math.max(1, zones[i].people *
            .52));
          if (p.purpose === 'leisure') daily *= Math.max(0, 1 - localBudget[i] / Math.max(1, zones[i]
            .people * .12));
          if (!daily) continue;
          const km = i === j ? Math.sqrt(zones[i].area) * .45 : R.distance(zones[i], zones[j]);
          for (const a of zoneAccess[i].people)
            for (const b of zoneAccess[j][p.field]) {
              const direct = R.distance(a, b);
              add(a, b, p.purpose, false, daily, direct);
              add(b, a, p.purpose, true, daily, direct);
            }
        }
    const idx = stationIndex(s, effective);
    for (const alloc of hubAlloc) {
      const {
        h,
        env,
        visitor,
        local,
        staffTrips
      } = alloc, connections = choices(h, idx.near(h), false).map(a => ({
        ...a,
        x: h.x,
        y: h.y
      }));
      base.hubStats[h.id].connections = connections.map(a => ({
        id: a.id,
        walk: a.km,
        share: a.share
      }));
      // A bounded share of the visitor market chooses destinations on a useful connected corridor.
      // Walk catchments are already area-partitioned across stations; duplicate stops cannot duplicate residents.
      const hubNodes = new Set(connections.map(a => a.id)),
        targets = [];
      let corridorMass = 0,
        marketWeight = 0;
      for (const [id, st] of Object.entries(catchment.stations)) {
        const node = +id;
        if (hubNodes.has(node) || !connections.some(c => component[c.id] === component[node])) continue;
        const km = R.distance(s.nodes[node], h),
          usefulness = 1 - Math.exp(-km / 2.5),
          mass = (effective ? st.jobs * .35 + st.shops * .8 + st.leisure : st.people + st.jobs * .6) *
          usefulness;
        if (mass <= 0) continue;
        const weight = (effective ? st.jobs * .35 + st.shops * .8 + st.leisure : st.people * .3 + st.jobs *
            .65 + st.leisure) * Math.exp(-km / 45) * usefulness,
          time = st.walk / 4.8 * 60;
        targets.push({
          id: node,
          share: 1,
          time,
          accessCost: 1.7 * time,
          weight,
          km
        });
        corridorMass += mass;
      }
      for (const a of targets)
        for (const b of connections)
          if (component[a.id] === component[b.id]) marketWeight += a.weight * b.share;
      const capture = marketWeight > 0 ? (s.urban?.version === 19 ? .90 : BAL.HUB_CAPTURE_MAX) * (1 - Math
        .exp(-corridorMass / (s.urban?.version === 19 ? 14000 : BAL.HUB_MARKET_SCALE))) : 0;
      base.hubStats[h.id].corridorCapture = capture;
      base.hubStats[h.id].corridorMass = corridorMass;
      base.hubStats[h.id].railReference = H.access(h).railReference;
      base.hubStats[h.id].referenceTarget = H.envelope(h).landside * H.access(h).railReference;
      base.hubStats[h.id].development = s.urban ? 1 - Math.exp(-corridorMass / 14000) : 1;
      for (const a of targets)
        for (const b of connections) {
          if (component[a.id] !== component[b.id] || !capture) continue;
          const daily = env.visitorArrivals * capture * a.weight * b.share / marketWeight,
            hst = {
              ...b,
              share: 1
            };
          add(hst, a, 'leisure', false, daily, a.km, h.id, 'visitor-arrival');
          add(a, hst, 'leisure', true, daily, a.km, h.id, 'visitor-return');
        }
      for (const i of active) {
        const km = R.distance(zones[i], h);
        for (const hst of connections) {
          for (const a of zoneAccess[i].leisure) {
            const d = env.visitorArrivals * (1 - capture) * visitor[i];
            add(hst, a, 'leisure', false, d, km, h.id, 'visitor-arrival');
            add(a, hst, 'leisure', true, d, km, h.id, 'visitor-return');
          }
          for (const a of zoneAccess[i].people) {
            const employees = staffTrips[i] * Math.min(1, zones[i].people * .52 / Math.max(1, staffBudget[
              i]));
            if (employees) {
              add(a, hst, 'work', false, employees, km, h.id, 'staff-outbound');
              add(hst, a, 'work', true, employees, km, h.id, 'staff-homebound');
            }
            const cap = localBudget[i] > zones[i].people * .12 ? zones[i].people * .12 / localBudget[i] : 1,
              d = local[i] * cap;
            add(a, hst, 'leisure', false, d, km, h.id, 'local-departure');
            add(hst, a, 'leisure', true, d, km, h.id, 'local-return');
          }
        }
      }
    }

    function routes(from, purpose, value = X.VOT[purpose]) {
      const key = from + '|' + purpose + '|' + value;
      const cached = cache.get(key);
      if (cached) return cached;
      const first = [...new Set(adj[from].map(e => e.service + '|' + e.dir))],
        trees = first.map(k => X.compactPaths(s, adj, from, 1 / value, k));
      cache.set(key, trees);
      return trees;
    }
    const strategyCache = CACHE.create(1024);

    function routeStrategy(from, to, purpose, value) {
      const key = from + '|' + to + '|' + purpose + '|' + value;
      const cached = strategyCache.get(key);
      if (cached) return cached;
      return strategyCache.set(key, strategy(routes(from, purpose, value).map(tree => X.pathAt(tree, to)),
        purpose, value));
    }
    const merged = new Map();
    let eligible = 0;
    for (const g of grouped.values()) {
      if (g.people < 1e-8) continue;
      eligible += g.people;
      const value = g.hub && !g.externalKind?.startsWith('staff') ? 60 : X.VOT[g.purpose],
        strat = routeStrategy(g.from, g.to, g.purpose, value);
      if (!strat.routes.length) continue;
      const access = g.access / g.people,
        accessCost = g.accessCost / g.people,
        km = g.km / g.people,
        avgFare = strat.routes.reduce((v, a) => v + a.path.fare * a.share, 0),
        minutes = strat.expected - avgFare / value,
        share = g.hub ? H.share(hubList.find(h => h.id === g.hub), {
          minutes,
          access,
          fare: avgFare,
          km
        }, g.externalKind) : modeShare({
          purpose: g.purpose,
          minutes,
          access,
          accessCost,
          fare: avgFare,
          km
        });
      for (const a of strat.routes) {
        const trips = g.people * share * a.share;
        if (trips < 1e-8) continue;
        const path = {
          ...a.path,
          minutes: a.path.minutes - a.path.edges[0].headway / 2 + strat.wait
        };
        delete path.key;
        delete path.node;
        const flow = {
          from: g.from,
          to: g.to,
          purpose: g.purpose,
          back: g.back,
          trips,
          demandTrips: trips,
          path,
          population: g.people * a.share,
          walk: access,
          rail: path.minutes + access,
          road: 8 + km / 23 * 60 * 1.22,
          hub: g.hub,
          externalKind: g.externalKind,
          ...(effective ? {
            routeOptions: strat.routes.length
          } : {})
        };
        const flowKey = [g.from, g.to, g.purpose, g.back, g.hub, g.externalKind, a.path.edges[0].service, a
            .path.edges[0].dir
          ].join('|'),
          prior = merged.get(flowKey);
        if (prior) {
          const old = prior.demandTrips;
          for (const k of ['walk', 'rail', 'road', 'population']) {
            if (k === 'population') prior[k] += flow[k];
            else prior[k] = (prior[k] * old + flow[k] * trips) / (old + trips);
          }
          prior.trips += trips;
          prior.demandTrips += trips;
          if (effective) prior.routeOptions = Math.max(prior.routeOptions, flow.routeOptions);
        } else merged.set(flowKey, flow);
        base.purposeTotals[g.purpose] += trips;
        if (g.hub) {
          const st = base.hubStats[g.hub];
          st.riders += trips;
          if (g.externalKind?.startsWith('staff')) st.staffRiders += trips;
          else st.passengerRiders += trips;
          if (g.externalKind === 'visitor-arrival' || g.externalKind === 'local-return' || g
            .externalKind === 'staff-homebound') st.arrivals += trips;
          else st.departures += trips;
        }
      }
    }
    base.flows = [...merged.values()];
    KD.capacity(s, base, X.expand(s), X, R);
    base.uncoveredTrips = Math.max(0, totalTrips - eligible);
    base.diagnostics = {
      ...base.diagnostics,
      ...diagnostics,
      connectedDemand: eligible,
      railDemand: base.flows.reduce((v, f) => v + f.demandTrips, 0),
      zones: n,
      eligiblePairs: grouped.size,
      calculationMs: Date.now() - started,
      accessSampling: SAMPLES * SAMPLES,
      memory: {
        routeTrees: cache.stats(),
        strategies: strategyCache.stats(),
        routing: 'rust-wasm-abi1',
        demand: 'rust-wasm-demand-abi1',
        wasm: X.routingStatus()
      }
    };
    if (effective) base.lineConnections = K.summarize(s, base);
    return base;
  }
  const api = {
    assign,
    local,
    evaluate,
    choices,
    distribution,
    ipf,
    modeShare,
    strategy,
    profiles,
    MODE_ASSUMPTIONS,
    ACCESS_WEIGHTS
  };
  if (node) module.exports = api;
  else root.RailDemand = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);