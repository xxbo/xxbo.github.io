/* A/B body classes follow Chinese metro naming. Capacity and prices are game assumptions. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    B = node ? require('./game-balance') : root.RailBalance;
  const SPECS = Object.fromEntries([4, 6, 8].flatMap(cars => ['B', 'A'].map(type => {
    const id = cars + type;
    return [id, {
      id,
      cars,
      type,
      width: type === 'A' ? 3 : 2.8,
      length: cars * (type === 'A' ? 23 : 20),
      capacity: cars * (type === 'A' ? 310 : 240),
      price: cars * B.CAR * (type === 'A' ? 1.3 : 1)
    }];
  })));
  const count = n => Number.isInteger(n) && n >= 0 && n <= 80 && n % 2 === 0;

  function upgrade(s) {
    if (s.routeModel !== 9) return s;
    let migrated = false;
    if (!s.depot) s.depot = {
      version: 18,
      stock: Object.fromEntries(Object.keys(SPECS).map(k => [k, 0]))
    };
    for (const l of s.services)
      if (!l.fleetManaged) {
        migrated = true;
        l.stockSpec = ([4, 6, 8].includes(l.cars) ? l.cars : 6) + 'B';
        l.cars = SPECS[l.stockSpec].cars;
        l.fleetManaged = true;
        l.dispatch = {
          mode: 'manual',
          manual: l.fleet || 0,
          offPeak: l.fleet || 0,
          peak: l.fleet || 0
        };
        s.depot.stock[l.stockSpec] = (s.depot.stock[l.stockSpec] || 0) + (l.fleet || 0);
      } if (migrated) {
      let removed = 0;
      for (const l of s.services)
        if (l.patterns) {
          l.patterns = l.patterns.filter(p => {
            const valid = p.kind !== 'cross' || s.services.find(x => x.id === p.target)?.stockSpec === l
              .stockSpec;
            if (!valid) removed++;
            return valid;
          });
          if (!l.patterns.length) delete l.patterns;
        } if (removed) s.depot.migrationNotice = '旧跨线交路中有 ' + removed + ' 个车型或编组不兼容，已停用这些交路，请在线路详情重新安排。';
    }
    return s;
  }

  function peak(minute) {
    const m = ((minute % 1440) + 1440) % 1440;
    return m >= 420 && m < 540 || m >= 1020 && m < 1140;
  }

  function planned(l, minute = 420) {
    if (!l.fleetManaged) return l.fleet;
    const d = l.dispatch;
    return d.mode === 'auto' ? (peak(minute) ? d.peak : d.offPeak) : d.manual;
  }

  function allocations(l, minute = 420) {
    const ps = l.patterns || [{
        fleet: l.fleet
      }],
      total = planned(l, minute);
    if (!total) return ps.map(() => 0);
    const weights = ps.map(p => p.fleet),
      sum = weights.reduce((a, b) => a + b, 0);
    if (!sum) return ps.map(() => 0);
    const out = ps.map(() => 2),
      remaining = (total - out.length * 2) / 2,
      shares = weights.map(n => remaining * n / sum),
      floor = shares.map(Math.floor);
    for (let i = 0; i < out.length; i++) out[i] += floor[i] * 2;
    let left = remaining - floor.reduce((a, b) => a + b, 0);
    const order = shares.map((v, i) => ({
      i,
      frac: v - floor[i]
    })).sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let i = 0; i < left; i++) out[order[i].i] += 2;
    return out;
  }

  function recommend(s, l, daily = 0) {
    const capacity = SPECS[l.stockSpec].capacity,
      loop = l.stops[0] === l.stops.at(-1),
      duration = l.trackIds.reduce((v, id) => v + s.tracks.find(t => t.id === id).km / 48 * 60, 0) + (l
        .stops.length - 1) * .6,
      cycle = loop ? duration * (l.loopDirection && l.loopDirection !== 'both' ? 1 : 2) : 2 * (duration +
        1),
      minimum = 2 * (l.patterns?.length || 1),
      available = Math.max(0, Math.min(80, Math.floor(free(s, l.stockSpec, l.id) / 2) * 2)),
      need = share => Math.max(minimum, Math.ceil(cycle * Math.min(30, Math.max(share === .18 ? 6 : 3, Math
        .max(0, daily) * share * .65 / (capacity * .8))) / 60 / 2) * 2),
      offNeed = need(.06),
      peakNeed = need(.18),
      take = n => available < minimum ? 0 : Math.min(available, n);
    return {
      offPeak: take(offNeed),
      peak: take(peakNeed),
      offNeed,
      peakNeed,
      available
    };
  }

  function reserved(s, spec, except) {
    return s.services.filter(l => l.fleetManaged && l.stockSpec === spec && l.id !== except).reduce((v,
      l) => v + l.fleet, 0);
  }

  function free(s, spec, except) {
    return (s.depot?.stock[spec] || 0) - reserved(s, spec, except);
  }

  function validLine(l) {
    if (!l.fleetManaged) return true;
    const d = l.dispatch,
      ps = l.patterns?.length || 1,
      min = ps * 2;
    return !!SPECS[l.stockSpec] && l.cars === SPECS[l.stockSpec].cars && count(l.fleet) && d && ['manual',
        'auto'
      ].includes(d.mode) && ['manual', 'offPeak', 'peak'].every(k => count(d[k])) && d.peak >= d.offPeak &&
      l.fleet === (d.mode === 'auto' ? Math.max(d.offPeak, d.peak) : d.manual) && [d.mode === 'auto' ? d
        .offPeak : d.manual, d.mode === 'auto' ? d.peak : d.manual
      ].every(n => n === 0 || n >= min);
  }

  function validate(s) {
    if (!s.depot) return s.services.every(l => !l.fleetManaged);
    return s.depot.version === 18 && s.depot.stock && Object.keys(s.depot.stock).length === Object.keys(
      SPECS).length && Object.keys(SPECS).every(k => Number.isInteger(s.depot.stock[k]) && s.depot.stock[
      k] >= 0 && s.depot.stock[k] <= 2400 && reserved(s, k) <= s.depot.stock[k]) && s.services.every(
      validLine);
  }

  function purchase(s, spec, n) {
    if (!s.depot || !SPECS[spec] || !Number.isInteger(n) || n < 1 || n > 80 || (s.depot.stock[spec] || 0) +
      n > 2400) return {
      error: '请选择有效车型和 1—80 列购买数量。'
    };
    s.depot.stock[spec] += n;
    return {
      spec,
      count: n
    };
  }

  function value(s) {
    return s.depot ? Object.entries(s.depot.stock).reduce((v, [k, n]) => v + (SPECS[k]?.price || 0) * n,
      0) : s.services.reduce((v, l) => v + l.fleet * l.cars * B.CAR, 0);
  }

  function configure(l, d) {
    if (!d || !['manual', 'auto'].includes(d.mode) || !['manual', 'offPeak', 'peak'].every(k => count(d[
        k]))) return {
      error: '投放数量须为 0—80 的偶数列，双向运营各半分配。'
    };
    if (d.peak < d.offPeak) return {
      error: '高峰投放不能少于平峰。'
    };
    l.dispatch = {
      ...d
    };
    l.fleet = d.mode === 'auto' ? Math.max(d.peak, d.offPeak) : d.manual;
    if (!validLine(l)) return {
      error: '每个交路至少需要双向各 1 列，请增加投放或减少交路。'
    };
    return {};
  }
  const api = {
    SPECS,
    upgrade,
    peak,
    planned,
    allocations,
    reserved,
    free,
    validate,
    validLine,
    purchase,
    value,
    configure,
    recommend
  };
  if (node) module.exports = api;
  else root.RailFleet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
