/* Transit-led cellular urban development. Behavioural coefficients, thresholds and clock are game rules. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    H = node ? require('./hubs') : root.RailHubs,
    F = node ? require('./fleet') : root.RailFleet,
    D = node ? require('./city-development') : root.RailDevelopment;
  const VERSION = 19,
    STEP = 360,
    SIZE = 12,
    AREA = (SIZE * .045) ** 2,
    FIELDS = ['people', 'jobs', 'shops', 'industry', 'leisure'];
  const TYPES = {
    school: {
      name: '学校',
      icon: '学',
      color: '#397bd5',
      radius: [.8, 1.4, 2],
      capacity: [600, 1800, 4500],
      price: [20e6, 60e6, 160e6],
      jobs: [45, 120, 300],
      visits: [300, 900, 2200]
    },
    hospital: {
      name: '医院',
      icon: '医',
      color: '#df706b',
      radius: [1.5, 2.5, 4],
      capacity: [800, 2400, 6000],
      price: [50e6, 140e6, 360e6],
      jobs: [150, 500, 1200],
      visits: [500, 1600, 4000]
    },
    park: {
      name: '公园',
      icon: '园',
      color: '#37977b',
      radius: [.6, 1.2, 2.3],
      capacity: [600, 2000, 6000],
      price: [12e6, 36e6, 96e6],
      jobs: [15, 40, 100],
      visits: [400, 1400, 4200]
    }
  };
  Object.assign(TYPES, {
    university: {
      name: '大学',
      icon: '大',
      color: '#6574c6',
      radius: [1, 1.8, 2.8],
      capacity: [1800, 5500, 14000],
      price: [40e6, 120e6, 320e6],
      jobs: [180, 550, 1400],
      visits: [1000, 3200, 8000],
      needRate: .08,
      effect: '住宅 ↑↑ · 商业 ↑ · 科研就业 ↑'
    },
    library: {
      name: '图书馆',
      icon: '文',
      color: '#a778ad',
      radius: [.8, 1.5, 2.4],
      capacity: [600, 2000, 5000],
      price: [16e6, 48e6, 128e6],
      jobs: [35, 90, 220],
      visits: [450, 1400, 3600],
      needRate: .03,
      effect: '住宅 ↑↑ · 文化商业 ↑'
    },
    sports: {
      name: '体育中心',
      icon: '体',
      color: '#cf8756',
      radius: [1, 1.8, 3],
      capacity: [1200, 4000, 10000],
      price: [24e6, 72e6, 200e6],
      jobs: [60, 180, 500],
      visits: [1000, 3200, 8500],
      needRate: .04,
      effect: '休闲商业 ↑↑ · 住宅 ↑'
    },
    exhibition: {
      name: '会展中心',
      icon: '展',
      color: '#c39638',
      radius: [1.2, 2.2, 3.5],
      capacity: [1800, 6000, 18000],
      price: [45e6, 140e6, 380e6],
      jobs: [150, 500, 1400],
      visits: [2000, 7000, 21000],
      needRate: .04,
      effect: '商业 ↑↑↑ · 商务到访 ↑'
    },
    logistics: {
      name: '物流中心',
      icon: '货',
      color: '#897399',
      radius: [1.2, 2.2, 3.5],
      capacity: [2500, 8000, 22000],
      price: [32e6, 96e6, 260e6],
      jobs: [120, 400, 1100],
      visits: [80, 200, 500],
      needRate: .03,
      effect: '工业 ↑↑↑ · 周边住宅吸引力 ↓'
    }
  });
  TYPES.school.effect = '住宅 ↑↑↑ · 教育到访 ↑';
  TYPES.hospital.effect = '住宅 ↑↑↑ · 服务就业 ↑';
  TYPES.park.effect = '住宅 ↑↑ · 休闲到访 ↑';

  function needRate(kind) {
    return TYPES[kind].needRate ?? (kind === 'school' ? .12 : kind === 'hospital' ? .025 : .05);
  }
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)),
    dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * .045,
    cache = new WeakMap(),
    terrainCache = new WeakMap();

  function init(s) {
    if (!s.urban) s.urban = {
      version: VERSION,
      revision: 0,
      step: 0,
      lastMinute: s.economy?.minute ?? 420,
      started: s.economy?.minute ?? 420,
      cells: {},
      facilities: [],
      nextId: 1,
      history: [],
      totals: Object.fromEntries(FIELDS.map(k => [k, 0]))
    };
    return s.urban;
  }
  // Automatic city destinations are deterministic game facilities, not a real POI inventory.
  function enableAutomatic(s, base, places = []) {
    const u = init(s);
    if (u.facilityMode === 'automatic') return false;
    const refund = facilitiesValue(s);
    for (const f of u.facilities) {
      f.system = true;
      f.name = f.name || TYPES[f.kind].name;
    }
    if (refund && s.economy) {
      s.economy.cash += refund;
      s.economy.infrastructureRebate = (s.economy.infrastructureRebate || 0) + refund;
      s.economy.ledger.unshift({
        minute: s.economy.minute,
        type: '市政移交 · 退还设施投资',
        amount: refund
      });
      s.economy.ledger = s.economy.ledger.slice(0, 80);
    }
    const anchors = [],
      hubs = H.forRegion(s.region),
      source = (places.length ? places : base.cells.filter(c => c.people > 100).sort((a, b) => b.people - a
        .people)).filter(p => buildable(s, base, p) && !hubs.some(h => dist(h, p) < .25)).map(p => ({
        x: p.x,
        y: p.y,
        name: p.name || '城市片区'
      }));
    while (source.length && anchors.length < 96) {
      let best = 0;
      if (anchors.length) {
        let score = -1;
        for (let i = 0; i < source.length; i++) {
          const d = Math.min(...anchors.map(a => dist(a, source[i])));
          if (d > score) {
            score = d;
            best = i;
          }
        }
        if (score < 2.4) break;
      }
      anchors.push(source.splice(best, 1)[0]);
    }
    const kinds = Object.keys(TYPES);
    u.autoCandidates = anchors.map((p, i) => ({
      ...p,
      kind: kinds[i % kinds.length],
      level: 1 + (i % 11 === 0 ? 1 : 0)
    }));
    u.facilityMode = 'automatic';
    u.revision++;
    autoFacilities(s);
    return true;
  }

  function autoFacilities(s) {
    const u = s.urban;
    if (u?.facilityMode !== 'automatic') return;
    const people = Object.values(u.cells).reduce((v, c) => v + c.r, 0),
      target = Math.min(u.autoCandidates.length, 48 + Math.floor(people / 18000));
    let changed = false;
    for (const [i, p] of u.autoCandidates.slice(0, target).entries()) {
      if (u.facilities.length >= 160) break;
      if (u.facilities.some(f => f.autoKey === i || f.kind === p.kind && dist(f, p) < .4)) continue;
      u.facilities.push({
        id: 'u' + u.nextId++,
        kind: p.kind,
        level: p.level,
        x: p.x,
        y: p.y,
        name: p.name + ' · ' + TYPES[p.kind].name,
        system: true,
        autoKey: i,
        opened: s.economy?.minute ?? 420
      });
      changed = true;
    }
    for (const f of u.facilities) {
      const local = Object.values(u.cells).reduce((v, c) => v + (dist(c, f) < TYPES[f.kind].radius[f.level -
          1] ? c.r : 0), 0),
        level = local > 40000 ? 3 : local > 10000 ? 2 : 1;
      if (level > f.level) {
        f.level = level;
        changed = true;
      }
    }
    if (changed) u.revision++;
  }

  function enableDevelopment(s, base, places = []) {
    return D.enable(s, base, places, H.forRegion(s.region), p => buildable(s, base, p));
  }

  function developmentSummary(s) {
    return D.summary(s, stations(s));
  }

  function connection(s, f) {
    const ns = stations(s),
      near = ns.map(n => ({
        id: n.id,
        walk: dist(n, f) * 1.25,
        service: n.service
      })).sort((a, b) => a.walk - b.walk),
      nearest = near[0] || null,
      linked = near.filter(n => n.walk <= .8 && n.service === 1),
      t = TYPES[f.kind],
      demand = t.visits[f.level - 1] + t.jobs[f.level - 1] * 1.04;
    return {
      nearest,
      linked,
      connected: linked.length > 0,
      demand,
      priority: demand * (linked.length ? 0 : 1) / (1 + (nearest?.walk || 0) / 4),
      status: linked.length ? '已接驳' : nearest && nearest.walk <= .8 ? '车站未投放列车' : '待接驳'
    };
  }

  function validate(s) {
    const u = s.urban;
    if (!D.valid(s)) return false;
    if (!u) return true;
    if (u.facilityMode === 'automatic' && (!Array.isArray(u.autoCandidates) || u.autoCandidates.length >
        96 || u.autoCandidates.some(f => !TYPES[f.kind] || !Number.isFinite(f.x) || !Number.isFinite(f.y) ||
          ![1, 2, 3].includes(f.level) || f.x < 25 || f.y < 25 || f.x > s.world.width - 25 || f.y > s.world
          .height - 25))) return false;
    return u.version === VERSION && Number.isInteger(u.revision) && u.revision >= 0 && Number.isInteger(u
        .step) && u.step >= 0 && Number.isFinite(u.lastMinute) && u.lastMinute >= 420 && Number.isFinite(u
        .started) && u.started >= 420 && Number.isInteger(u.nextId) && u.nextId > 0 && u.cells && Object
      .keys(u.cells).length <= 24000 && Object.values(u.cells).every(c => c && Number.isFinite(c.x) &&
        Number.isFinite(c.y) && c.x >= 25 && c.y >= 25 && c.x <= s.world.width - 25 && c.y <= s.world
        .height - 25 && ['r', 'c', 'i'].every(k => Number.isFinite(c[k]) && c[k] >= 0 && c[k] <= 2e5)) &&
      Array.isArray(u.facilities) && u.facilities.length <= 160 && new Set(u.facilities.map(f => f.id))
      .size === u.facilities.length && u.facilities.every(f => TYPES[f.kind] && [1, 2, 3].includes(f
          .level) && Number.isFinite(f.x) && Number.isFinite(f.y) && f.x >= 25 && f.y >= 25 && f.x <= s
        .world
        .width - 25 && f.y <= s.world.height - 25) && Array.isArray(u.history) && u.history.length <= 60;
  }

  function terrain(base, p) {
    let index = terrainCache.get(base);
    if (!index) {
      const bins = new Map();
      for (const c of base.cells) {
        const key = Math.floor(c.x / 60) + ':' + Math.floor(c.y / 60);
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(c);
      }
      index = bins;
      terrainCache.set(base, index);
    }
    let best = null,
      d = Infinity;
    const x = Math.floor(p.x / 60),
      y = Math.floor(p.y / 60);
    for (let a = x - 1; a <= x + 1; a++)
      for (let b = y - 1; b <= y + 1; b++)
        for (const c of index.get(a + ':' + b) || []) {
          const q = Math.hypot(c.x - p.x, c.y - p.y);
          if (q < d) {
            d = q;
            best = c;
          }
        }
    return best;
  }

  function buildable(s, base, p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 25 || p.y < 25 || p.x > s.world
      .width - 25 || p.y > s.world.height - 25) return false;
    const c = terrain(base, p);
    if (!c) return false;
    if (H.forRegion(s.region).some(h => h.type !== 'port' && dist(h, p) < .6)) return true;
    if (s.region === 'gba') {
      const B = node ? require('./regions') : root.RailRegions,
        G = node ? require('./gba-data') : root.RailGBA,
        ll = B.latLon(p, 'gba');
      return G.land(ll.lon, ll.lat);
    }
    return c.populationValid || c.survey > .01;
  }

  function facilitiesValue(s) {
    return (s.urban?.facilities || []).filter(f => !f.system).reduce((v, f) => v + TYPES[f.kind].price[f
      .level - 1], 0);
  }

  function plan(s, base, kind, p) {
    const u = init(s);
    if (u.facilityMode === 'automatic') return {
      error: '城市设施由系统建设，请规划地铁接驳。'
    };
    if (!TYPES[kind] || !buildable(s, base, p)) return {
      error: '请在可开发陆地区域规划设施。'
    };
    if (u.facilities.length >= 160) return {
      error: '最多规划160座市政设施。'
    };
    if (u.facilities.some(f => f.kind === kind && dist(f, p) < .22)) return {
      error: '同类设施过近，请升级已有设施或换一个位置。'
    };
    const f = {
      id: 'u' + u.nextId++,
      kind,
      level: 1,
      x: p.x,
      y: p.y,
      opened: s.economy?.minute ?? 420
    };
    u.facilities.push(f);
    u.revision++;
    return {
      facilityId: f.id
    };
  }

  function upgrade(s, id) {
    if (s.urban?.facilityMode === 'automatic') return {
      error: '设施由系统自动升级。'
    };
    const f = s.urban?.facilities.find(f => f.id === id);
    if (!f) return {
      error: '设施不存在。'
    };
    if (f.level >= 3) return {
      error: '已达最高等级。'
    };
    f.level++;
    s.urban.revision++;
    return {};
  }

  function remove(s, id) {
    const u = s.urban;
    if (u?.facilityMode === 'automatic') return {
      error: '系统城市设施不可拆除。'
    };
    if (!u?.facilities.some(f => f.id === id)) return {
      error: '设施不存在。'
    };
    u.facilities = u.facilities.filter(f => f.id !== id);
    u.revision++;
    return {};
  }

  function stations(s) {
    return [...new Set(s.services.flatMap(l => l.stops))].map(id => {
      const lines = s.services.filter(l => l.stops.includes(id)),
        n = s.nodes[id],
        neighbors = new Set(lines.flatMap(l => l.stops)),
        operated = lines.some(l => !l.fleetManaged || (l.dispatch.mode === 'auto' ? Math.max(l.dispatch
          .offPeak, l.dispatch.peak) : l.dispatch.manual) > 0);
      return {
        ...n,
        connections: neighbors.size - 1,
        interchange: Math.max(0, lines.length - 1),
        service: operated ? 1 : .3
      };
    });
  }

  function context(s) {
    const u = s.urban,
      bins = new Map();
    for (const c of Object.values(u.cells)) {
      const key = Math.floor(c.x / 30) + ':' + Math.floor(c.y / 30);
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(c);
    }
    const facilities = u.facilities.map(f => {
      const t = TYPES[f.kind],
        radius = t.radius[f.level - 1],
        local = Object.values(u.cells).reduce((v, c) => v + (dist(c, f) <= radius ? c.r : 0), 0),
        need = local * needRate(f.kind);
      return {
        ...f,
        radius,
        quality: Math.min(1, t.capacity[f.level - 1] / Math.max(1, need))
      };
    });
    return {
      stations: stations(s),
      facilities,
      near(p) {
        const x = Math.floor(p.x / 30),
          y = Math.floor(p.y / 30),
          out = [];
        for (let a = x - 1; a <= x + 1; a++)
          for (let b = y - 1; b <= y + 1; b++)
            for (const c of bins.get(a + ':' + b) || [])
              if (dist(c, p) < 1.2) out.push(c);
        return out;
      }
    };
  }

  function zone(s, p, ctx = null) {
    const u = init(s);
    ctx = ctx || context(s);
    const out = {
      residential: 0,
      commercial: 0,
      industrial: 0,
      rail: 0,
      amenities: 0,
      hub: 0,
      ...Object.fromEntries(Object.keys(TYPES).map(k => [k, 0]))
    };
    let rail = 0,
      interchange = 0,
      network = 0;
    for (const n of ctx.stations) {
      const d = dist(p, n);
      if (d > 3.2) continue;
      const v = Math.exp(-d / .9);
      rail = Math.max(rail, v * (.72 + .28 * n.service));
      interchange = Math.max(interchange, v * Math.min(1, n.interchange / 2));
      network = Math.max(network, v * Math.min(1, n.connections / 12));
    }
    const near = ctx.near(p),
      residents = near.reduce((v, c) => v + c.r, 0),
      commercial = near.reduce((v, c) => v + c.c, 0),
      industry = near.reduce((v, c) => v + c.i, 0),
      population = clamp(residents / 22000),
      jobs = clamp((commercial + industry) / 12000),
      agglomeration = clamp((residents + commercial) / 45000);
    for (const f of ctx.facilities) {
      const d = dist(p, f),
        radius = f.radius;
      if (d > radius) continue;
      const v = (1 - d / radius) * (.4 + .6 * f.quality);
      out[f.kind] = Math.max(out[f.kind], v);
    }
    let hub = 0,
      freight = 0;
    for (const h of H.forRegion(s.region)) {
      const v = Math.exp(-dist(h, p) / 1.5) * clamp(Math.log1p(H.daily(h)) / 13);
      hub = Math.max(hub, v);
      if (['port', 'airport', 'rail'].includes(h.type)) freight = Math.max(freight, v);
    }
    const amenity = clamp(out.school * .75 + out.hospital * .6 + out.park * .65),
      pollution = clamp(industry / 10000),
      noise = (Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453) % 1 * .025;
    out.rail = rail;
    out.amenities = amenity;
    out.hub = hub;
    out.residential = clamp(Math.min(.35, out.university * .24 + out.library * .18 + out.sports * .12) - out
      .logistics * .16 + .26 + .43 * rail + .13 * network + .45 * amenity + .10 * jobs + .08 *
      agglomeration - .18 * pollution + noise);
    out.commercial = clamp(Math.min(.4, out.exhibition * .30 + out.library * .15 + out.sports * .22 + out
        .university * .16) + .14 + .44 * rail + .18 * population + .18 * interchange + .20 * hub + .12 *
      agglomeration + .12 * (out.school + out.hospital) + noise);
    out.industrial = clamp(Math.min(.4, out.logistics * .35 + out.university * .08) + .22 + .20 * rail +
      .23 * freight + .16 * population + .12 * (1 - rail) - .19 * amenity - .17 * interchange - .10 *
      hub + noise);
    return D.score(s, p, out);
  }
  // Local neighbourhood queries use a bounded candidate grid. No whole-map population is seeded.
  function candidates(s, base) {
    const u = s.urban,
      keys = new Set(Object.keys(u.cells)),
      anchors = [...stations(s).map(n => ({
        ...n,
        radius: 2.2
      })), ...u.facilities.map(f => ({
        ...f,
        radius: u.facilityMode === 'automatic' ? 1.1 : TYPES[f.kind].radius[f.level - 1] + .6
      })), ...(u.development?.projects || []).filter(p => D.phase(s, p).release > 0).map(p => ({
        ...p,
        radius: p.radius
      }))];
    for (const a of anchors) {
      const radius = a.radius / .045,
        x = Math.floor(a.x / SIZE),
        y = Math.floor(a.y / SIZE),
        r = Math.ceil(radius / SIZE);
      for (let i = x - r; i <= x + r; i++)
        for (let j = y - r; j <= y + r; j++) {
          const p = {
            x: (i + .5) * SIZE,
            y: (j + .5) * SIZE
          };
          if (dist(a, p) <= a.radius && buildable(s, base, p)) keys.add(i + ':' + j);
        }
    }
    return [...keys].slice(0, 24000);
  }

  function step(s, base) {
    autoFacilities(s);
    const u = init(s),
      keys = candidates(s, base),
      ctx = context(s),
      before = {
        ...u.cells
      },
      updates = {};
    let maxGrowth = 0;
    for (const key of keys) {
      const [ix, iy] = key.split(':').map(Number), old = before[key] || {
        x: (ix + .5) * SIZE,
        y: (iy + .5) * SIZE,
        r: 0,
        c: 0,
        i: 0
      }, v = zone(s, old, ctx), nearRail = v.rail > .08, nearAmenity = v.amenities > .12 || Object.keys(
        TYPES).some(k => v[k] > .1);
      if (!nearRail && !nearAmenity && !old.r && !old.c && !old.i && !(u.development && Math.max(v
          .marketResidential, v.marketCommercial, v.marketIndustrial) > .1)) continue;
      const phases = score => score < .40 ? 0 : score < .59 ? 1 : score < .73 ? 2 : score < .86 ? 3 : 4,
        rl = phases(v.residential),
        cl = phases(v.commercial),
        il = phases(v.industrial),
        density = [0, 5000, 14000, 36000, 60000],
        jobDensity = [0, 2800, 12000, 36000, 70000],
        industrialDensity = [0, 2000, 5500, 11000, 18000],
        resCap = density[rl] * AREA * (nearRail ? 1 : .4),
        comCap = jobDensity[cl] * AREA * (nearRail ? 1 : .2),
        indCap = industrialDensity[il] * AREA * .55,
        targets = {
          r: resCap,
          c: comCap,
          i: indCap
        },
        next = {
          ...old,
          scores: v,
          levels: {
            r: rl,
            c: cl,
            i: il
          },
          age: (old.age || 0) + 1
        };
      for (const k of ['r', 'c', 'i']) {
        const target = targets[k],
          rate = k === 'r' ? .09 : .065,
          delta = target >= old[k] ? (target - old[k]) * rate : -(old[k] - target) * (u.development ? 0 :
            .015);
        next[k] = Math.max(0, old[k] + delta);
        maxGrowth += Math.max(0, delta);
      }
      if (next.r + next.c + next.i > .1) updates[key] = next;
    }
    if (u.development) D.allocate(s, before, updates);
    u.cells = updates;
    u.step++;
    u.lastMinute += STEP;
    u.revision++;
    const view = city(s, base);
    u.totals = {
      ...view.totals
    };
    if (u.step % 4 === 0) {
      u.history.push({
        day: u.step / 4,
        ...u.totals,
        districts: Object.keys(u.cells).length
      });
      u.history = u.history.slice(-60);
    }
    return maxGrowth;
  }

  function advance(s, base, minute) {
    if (!s.urban) return false;
    const u = s.urban;
    let changed = false;
    while (minute - u.lastMinute >= STEP - 1e-7) {
      step(s, base);
      changed = true;
    }
    return changed;
  }

  function city(s, base) {
    if (!s.urban) return base;
    const u = s.urban,
      prior = cache.get(u);
    if (prior?.revision === u.revision) return prior.city;
    const cells = Object.entries(u.cells).map(([id, c]) => ({
        id,
        ...c,
        w: SIZE,
        h: SIZE,
        area: AREA,
        people: c.r,
        jobs: c.c + c.i,
        shops: c.c * .45 + c.r * .035,
        industry: c.i,
        leisure: c.r * .07 + c.c * .12,
        factory: c.i / 18000,
        survey: 1,
        populationValid: true,
        modelled: true
      })),
      map = new Map(cells.map(c => [c.id, c]));
    for (const f of u.facilities) {
      const id = Math.floor(f.x / SIZE) + ':' + Math.floor(f.y / SIZE);
      let c = map.get(id);
      if (!c) {
        c = {
          id,
          x: (Math.floor(f.x / SIZE) + .5) * SIZE,
          y: (Math.floor(f.y / SIZE) + .5) * SIZE,
          w: SIZE,
          h: SIZE,
          area: AREA,
          people: 0,
          jobs: 0,
          shops: 0,
          industry: 0,
          leisure: 0,
          factory: 0,
          survey: 1,
          populationValid: true,
          modelled: true
        };
        map.set(id, c);
        cells.push(c);
      }
      const t = TYPES[f.kind];
      c.jobs += t.jobs[f.level - 1];
      c.leisure += t.visits[f.level - 1];
    }
    const totals = Object.fromEntries(FIELDS.map(k => [k, cells.reduce((v, c) => v + c[k], 0)])),
      result = {
        cells,
        totals,
        cell: SIZE,
        area: AREA,
        metadata: {
          ...base.metadata,
          demandZoneUnits: 80,
          populationSum: totals.people,
          growthModel: true,
          effectiveConnections: !!u.development,
          populationKind: '轨道与市政驱动的动态模拟人口'
        }
      };
    cache.set(u, {
      revision: u.revision,
      city: result
    });
    return result;
  }

  function facilityStats(s, f) {
    const t = TYPES[f.kind],
      radius = t.radius[f.level - 1],
      population = Object.values(s.urban.cells).reduce((v, c) => v + (dist(c, f) <= radius ? c.r : 0), 0),
      need = population * needRate(f.kind);
    return {
      radius,
      capacity: t.capacity[f.level - 1],
      population,
      need,
      load: need / t.capacity[f.level - 1],
      upkeep: f.system ? 0 : t.price[f.level - 1] * .001
    };
  }

  function upkeep(s) {
    return facilitiesValue(s) * .001;
  }
  const LAND_USES = {
    r: {
      label: '住',
      name: '住宅',
      color: '#4e9b83'
    },
    c: {
      label: '商',
      name: '商业',
      color: '#d99542'
    },
    i: {
      label: '工',
      name: '工业',
      color: '#9578be'
    }
  };

  function markers(cells, scale = 1) {
    const bin = Math.max(SIZE, 30 / Math.max(.001, scale)),
      groups = new Map();
    for (const c of cells) {
      const key = Math.floor(c.x / bin) + ':' + Math.floor(c.y / bin);
      let g = groups.get(key);
      if (!g) groups.set(key, g = {
        key,
        x: 0,
        y: 0,
        weight: 0,
        r: 0,
        c: 0,
        i: 0,
        area: 0,
        people: 0,
        jobs: 0
      });
      const amount = c.people + c.jobs;
      if (amount < 2) continue;
      g.x += c.x * amount;
      g.y += c.y * amount;
      g.weight += amount;
      g.r += c.people;
      g.c += Math.max(0, c.jobs - c.industry);
      g.i += c.industry;
      g.people += c.people;
      g.jobs += c.jobs;
      g.area += c.area;
    }
    const out = [];
    for (const g of groups.values()) {
      if (!g.weight) continue;
      g.x /= g.weight;
      g.y /= g.weight;
      const max = Math.max(g.r, g.c, g.i),
        kinds = Object.keys(LAND_USES).filter(k => g[k] >= Math.max(30, max * .15));
      for (const [i, kind] of kinds.entries()) {
        const hash = Math.sin(g.x * 12.9898 + g.y * 78.233 + i * 17.17) * 43758.5453,
          angle = (hash - Math.floor(hash)) * Math.PI * 2,
          offset = kinds.length > 1 ? Math.min(bin * .23, 11 / Math.max(.001, scale)) : Math.min(bin * .12,
            4 / Math.max(.001, scale));
        out.push({
          ...g,
          key: g.key + '|' + kind,
          kind,
          ...LAND_USES[kind],
          amount: g[kind],
          x: g.x + Math.cos(angle) * offset,
          y: g.y + Math.sin(angle) * offset
        });
      }
    }
    return out;
  }
  const api = {
    enableDevelopment,
    developmentSummary,
    developmentKinds: D.KINDS,
    VERSION,
    STEP,
    SIZE,
    AREA,
    TYPES,
    enableAutomatic,
    autoFacilities,
    connection,
    LAND_USES,
    markers,
    init,
    validate,
    terrain,
    buildable,
    plan,
    upgrade,
    remove,
    facilitiesValue,
    stations,
    zone,
    candidates,
    step,
    advance,
    city,
    facilityStats,
    upkeep
  };
  if (node) module.exports = api;
  else root.RailUrban = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
