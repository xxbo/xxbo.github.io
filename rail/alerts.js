/* Live crowding alerts: station occupancy, outside queues and line clearance/load. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    Q = node ? require('./ridership') : root.RailRidership,
    R = node ? require('./engine') : root.RailSim,
    X = node ? require('./service-plan') : root.RailServicePlan;

  function evaluate(s, rt) {
    const items = [],
      served = [...new Set(s.services.flatMap(l => l.stops))],
      queues = {},
      lineWait = {},
      plan = rt.plan || X.expand(s);
    for (const [key, q] of Object.entries(rt.nativeView?.queues || rt.queues || {})) {
      const [run, , station] = key.split('|'), n = Object.values(q).reduce((a, b) => a + b, 0), line = plan
        .services.find(l => l.id === run)?.parentLine || run;
      queues[station] = (queues[station] || 0) + n;
      lineWait[line] = (lineWait[line] || 0) + n;
    }
    for (const t of rt.nativeView?.transfers || rt.transfers || []) queues[t.station] = (queues[t.station] || 0) + t.amount;
    for (const id of served) {
      const cap = Q.limits(s, id).capacity,
        inside = queues[id] || 0,
        outside = Object.values((rt.nativeView?.outside || rt.outside)?.[id] || {}).reduce((a, b) => a + b, 0),
        ratio = inside / cap;
      if (ratio >= .85 || outside > 0) items.push({
        key: 'station:' + id,
        type: 'station',
        id,
        level: ratio >= .95 || outside > cap * .1 ? 'critical' : 'warning',
        name: s.nodes[id].name,
        message: outside > 0 ? `站内 ${Math.round(inside)} / ${cap} 人，站外 ${Math.round(outside)} 人等候` :
          `候车占用 ${Math.round(ratio*100)}%，接近站台容量`,
        ratio,
        inside,
        outside
      });
    }
    for (const l of s.services) {
      const trains = rt.trains.filter(t => (t.parentLine || t.service) === l.id),
        maxLoad = Math.max(0, ...trains.map(t => t.onboard / t.capacity)),
        waiting = lineWait[l.id] || 0,
        runs = plan.services.filter(r => (r.parentLine || r.id) === l.id),
        perMinute = runs.reduce((v, r) => v + R.capacity(r) * X.directions(r).length / R.effectiveHeadway(
          plan, r), 0),
        clearance = perMinute ? waiting / perMinute : waiting ? Infinity : 0,
        critical = clearance >= 20 || maxLoad >= .99 && waiting > 0;
      if (clearance >= 10 || maxLoad >= .9 && waiting > 0) items.push({
        key: 'line:' + l.id,
        type: 'line',
        id: l.id,
        level: critical ? 'critical' : 'warning',
        name: l.name,
        message: !perMinute ? '有候车客流但未投放列车' :
          `最高满载 ${Math.round(maxLoad*100)}%，候车 ${Math.round(waiting)} 人${clearance>=10?'，理论疏散约 '+Math.ceil(clearance)+' 分钟':''}`,
        ratio: maxLoad,
        waiting,
        clearance
      });
    }
    return items.sort((a, b) => (b.level === 'critical') - (a.level === 'critical') || b.ratio - a.ratio ||
      a.key.localeCompare(b.key));
  }
  const api = {
    evaluate
  };
  if (node) module.exports = api;
  else root.RailAlerts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
