/* Regional development opportunities and finite inflow. All coefficients are game rules. */
(function(root) {
  'use strict';
  const VERSION = 35,
    USES = ['r', 'c', 'i'],
    clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)),
    distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * .045;
  const KINDS = {
    residential: {
      name: '住宅拓展',
      color: '#328a62',
      mix: {
        r: 1,
        c: .35,
        i: .1
      },
      reason: '学校与生活服务完善后吸引居民，需要连接就业目的地。'
    },
    business: {
      name: '商务集聚',
      color: '#cf842b',
      mix: {
        r: .35,
        c: 1,
        i: .12
      },
      reason: '依赖居民腹地与换乘可达性，单独建设商业站不能保证客流。'
    },
    industry: {
      name: '产业发展',
      color: '#8865b1',
      mix: {
        r: .3,
        c: .25,
        i: 1
      },
      reason: '靠近劳动力、物流及对外交通更有优势，需要接通居住片区。'
    },
    mixed: {
      name: '城区更新',
      color: '#378694',
      mix: {
        r: .8,
        c: .8,
        i: .2
      },
      reason: '住宅与服务就业混合发展，适合补齐既有城区的连接。'
    }
  };
  const preferred = {
    gba: ['福田', '天河', '科技园', '松山湖', '宝安中心', '南沙', '禅城', '横琴', '沙田', '江北', '石岐', '新会'],
    tokyo: ['新宿', '渋谷', '池袋', '横浜', '大宮', '千葉', '立川', '町田', '川崎', '柏', '八王子', '船橋']
  };

  const native=(op,s,extra={})=>(typeof module!=='undefined'&&module.exports?require('./transactions-wasm'):root.RailTransactions).run(op,{state:{urban:{lastMinute:s.urban.lastMinute,development:s.urban.development,totals:s.urban.totals}},...extra});
  function enable(s, base, places, hubs, buildable) {
    if(!s.urban||s.urban.development)return false;s.urban.development=native(10,s,{region:s.region,places:places.filter(buildable),hubs});s.urban.revision++;return true;
  }

  function valid(s) {
    const d = s.urban?.development;
    if (d === undefined) return true;
    return d && d.version === VERSION && Number.isFinite(d.started) && d.started >= 420 && d.started <= s
      .urban.lastMinute + .01 && Array.isArray(d.projects) && d.projects.length <= 12 && new Set(d.projects
        .map(p => p.id)).size === d.projects.length && d.projects.every(p => typeof p.id === 'string' &&
        /^[a-zA-Z0-9_-]{1,23}$/.test(p.id) && typeof p.name === 'string' && p.name.length <= 80 && Object
        .hasOwn(KINDS, p.kind) && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 25 && p.y >= 25 &&
        p.x <= s.world.width - 25 && p.y <= s.world.height - 25 && Number.isFinite(p.radius) && p.radius >=
        1 && p.radius <= 4 && Number.isInteger(p.startDay) && p.startDay >= 0 && p.startDay <= 24) && (!d
        .last || ['r', 'c', 'i'].every(k => Number.isFinite(d.last.daily?.[k]) && d.last.daily[k] >= 0 &&
          Number.isFinite(d.last.added?.[k]) && d.last.added[k] >= 0));
  }

  function phase(s, p) {
    const v=native(5,s,{point:p});return {day:v.day,age:v.age,release:v.release,label:v.age<0?'筹备中':v.age<6?'启动建设':v.age<18?'持续建设':'成熟片区',until:v.until};
  }
  const potentialCache = new WeakMap();

  function potential(s, p) {
    return native(6,s,{point:p});
  }

  function score(s, p, v) {
    return native(7,s,{point:p,scores:v});
  }

  function budgets(s) {
    return native(8,s);
  }

  function allocate(s, before, updates) {
    const v=native(9,s,{before,updates});for(const [key,c]of Object.entries(v.updates))Object.assign(updates[key],c);s.urban.development.last=v.last;return v.added;
  }
  const summaryCache = new WeakMap();

  function summary(s, stations) {
    const u = s.urban,
      d = u?.development;
    if (!d) return null;
    const key = stations.map(n => n.id + ':' + n.name + ':' + n.x + ':' + n.y + ':' + n.service).join(','),
      cached = summaryCache.get(u);
    if (cached?.revision === u.revision && cached.key === key) return cached.value;
    const cells = Object.values(u.cells),
      projects = d.projects.map(p => {
        const stage = phase(s, p),
          near = stations.map(n => ({
            id: n.id,
            name: n.name,
            walk: distance(n, p) * 1.25,
            service: n.service
          })).sort((a, b) => a.walk - b.walk),
          nearest = near[0],
          served = near.some(n => n.walk <= .8 && n.service === 1),
          nearby = cells.filter(c => distance(c, p) <= p.radius),
          population = nearby.reduce((a, c) => a + c.r, 0),
          jobs = nearby.reduce((a, c) => a + c.c + c.i, 0);
        return {
          ...p,
          ...stage,
          nearest,
          served,
          population,
          jobs,
          priority: stage.release * (served ? .15 : 1) / (1 + (nearest?.walk || 0) / 6)
        };
      }).sort((a, b) => b.priority - a.priority || a.startDay - b.startDay),
      value = {
        projects,
        daily: budgets(s),
        last: d.last,
        started: d.started
      };
    summaryCache.set(u, {
      revision: u.revision,
      key,
      value
    });
    return value;
  }
  const api = {
    VERSION,
    KINDS,
    enable,
    valid,
    phase,
    potential,
    score,
    budgets,
    allocate,
    summary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailDevelopment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
