/* Frozen MAP62 fbf07978b329b2b3974eb693ebbae5230fcadd67; only module paths redirected. */
/* Transit-led cellular urban development. Behavioural coefficients, thresholds and clock are game rules. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    H = node ? require('../../rail/hubs') : root.RailHubs,
    F = node ? require('./rail-map62-fleet.cjs') : root.RailFleet,
    D = node ? require('../../rail/city-development') : root.RailDevelopment;
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

  function native(op,s,extra={}) {
    const T=node?require('../../rail/transactions-wasm'):root.RailTransactions;
    let urban=s.urban;
    if(op===1)urban={...urban,cells:Object.fromEntries(Object.entries(urban.cells).map(([id,c])=>[id,{...c,...(Object.hasOwn(c,'scores')?{scores:null}:{}),...(Object.hasOwn(c,'levels')?{levels:null}:{})}]))};
    if(op===12)urban={facilityMode:urban.facilityMode,facilities:urban.facilities,development:urban.development,lastMinute:urban.lastMinute};
    if(op===13||op===15||op===11)urban={};
    if(op===0||op===2||op===4||op===14)urban={...urban,cells:Object.fromEntries(Object.entries(urban.cells).map(([id,c])=>[id,{x:c.x,y:c.y,r:c.r,c:c.c,i:c.i}]))};
    return T.run(op,{state:{urban,services:s.services,nodes:s.nodes,economy:{minute:s.economy?.minute??420}},types:TYPES,
      hubs:H.forRegion(s.region).map(h=>({...h,daily:H.daily(h)})),...extra});
  }
  function adopt(u,v){Object.assign(u,v);}
  function cityProjection(s,v){v.cells=v.cells.map(c=>({id:c.id,...s.urban.cells[c.id],...c}));return v;}
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
    u.autoCandidates=native(11,s,{places:source});
    u.facilityMode = 'automatic';
    u.revision++;
    autoFacilities(s);
    return true;
  }

  function autoFacilities(s) {
    if(!s.urban)return;const result=native(4,s);adopt(s.urban,result);
  }

  function enableDevelopment(s, base, places = []) {
    return D.enable(s, base, places, H.forRegion(s.region), p => buildable(s, base, p));
  }

  function developmentSummary(s) {
    return D.summary(s, stations(s));
  }

  function connection(s, f) {
    const v=native(15,s,{facility:f});return {...v,status:v.connected?'已接驳':v.nearest&&v.nearest.walk<=.8?'车站未投放列车':'待接驳'};
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
      const B = node ? require('../../rail/regions') : root.RailRegions,
        G = node ? require('../../rail/gba-data') : root.RailGBA,
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
    return native(13,s);
  }

  function zone(s, p, ctx = null) {
    init(s);return native(2,s,{point:p});
  }
  // Local neighbourhood queries use a bounded candidate grid. No whole-map population is seeded.
  function candidates(s, base) {
    const keys=new Set(Object.keys(s.urban.cells));for(const p of native(12,s))if(buildable(s,base,p))keys.add(Math.floor(p.x/SIZE)+':'+Math.floor(p.y/SIZE));return [...keys].slice(0,24000);
  }

  function step(s, base) {
    init(s);const first=native(0,s);adopt(s.urban,first.urban);
    const keys=new Set(Object.keys(s.urban.cells));
    for(const p of first.points)if(buildable(s,base,p))keys.add(Math.floor(p.x/SIZE)+':'+Math.floor(p.y/SIZE));
    const result=native(1,s,{keys:[...keys].slice(0,24000),metadata:base.metadata});
    adopt(s.urban,result.urban);cache.set(s.urban,{revision:s.urban.revision,city:cityProjection(s,result.city)});return result.growth;
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
    if(!s.urban)return base;const prior=cache.get(s.urban);if(prior?.revision===s.urban.revision)return prior.city;
    const result=cityProjection(s,native(3,s,{metadata:base.metadata}));cache.set(s.urban,{revision:s.urban.revision,city:result});return result;
  }

  function facilityStats(s, f) {
    return native(14,s,{facility:f});
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
