/* Read-only decision support. Hour shares/thresholds are explicit game assumptions. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    X = node ? require('./service-plan') : root.RailServicePlan,
    F = node ? require('./fleet') : root.RailFleet,
    N = node ? require('./network') : root.RailNetwork,
    Q = node ? require('./ridership') : root.RailRidership,
    R = node ? require('./engine') : root.RailSim;
  const PEAK = .18,
    OFF = .06,
    TARGET = .8,
    even = n => Math.ceil(n / 2) * 2,
    clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    clone = v => JSON.parse(JSON.stringify(v));

  function signature(l) {
    return JSON.stringify([l.dispatch, l.patterns, l.stops, l.trackIds]);
  }

  function resize(ps, total) {
    const out = clone(ps),
      min = out.length * 2;
    if (total < min) return null;
    const sum = out.reduce((v, p) => v + p.fleet, 0),
      shares = out.map(p => (total - min) * p.fleet / Math.max(1, sum) / 2),
      extra = shares.map(Math.floor);
    let rest = (total - min) / 2 - extra.reduce((a, b) => a + b, 0);
    const order = shares.map((v, i) => ({
      i,
      v: v - extra[i]
    })).sort((a, b) => b.v - a.v || a.i - b.i);
    for (let i = 0; i < rest; i++) extra[order[i].i]++;
    out.forEach((p, i) => p.fleet = 2 + extra[i] * 2);
    return out;
  }

  function dispatchValues(l, offPeak, peak) {
    const total = Math.max(offPeak, peak),
      values = {
        dispatch: {
          mode: 'auto',
          manual: l.dispatch.manual,
          offPeak,
          peak
        }
      };
    if (l.patterns) {
      const p = resize(l.patterns, total);
      if (!p) return null;
      values.patterns = p;
    }
    return values;
  }

  function direction(s, run, id, dir) {
    if (!run) return dir;
    const i = run.trackIds.indexOf(id),
      t = s.tracks.find(t => t.id === id);
    return i >= 0 && t && run.stops[i] !== t.a ? -dir : dir;
  }

  function capacity(s, l, minute, prepared) {
    const op = prepared || X.expand(s, minute),
      runs = op.services.filter(r => r.parentLine === l.id),
      map = new Map();
    for (const r of runs) {
      const flow = R.capacity(r) * 60 / X.headway(op, r);
      for (const id of r.trackIds)
        for (const dir of X.directions(r)) {
          const key = id + ':' + direction(s, r, id, dir);
          map.set(key, (map.get(key) || 0) + flow);
        }
    }
    return map;
  }

  function peakRatio(demand, cap, share) {
    let max = 0;
    for (const [key, n] of demand) {
      const c = cap.get(key) || 0;
      if (n > 0) max = Math.max(max, c ? n * share / c : Infinity);
    }
    return max;
  }

  function analyze(s, forecast, rt) {
    const minute = rt.minute ?? s.economy.minute,
      op = X.expand(s, minute),
      peakOp = X.expand(s, 480),
      offOp = X.expand(s, 720),
      lineKm = new Map(s.services.map(l => [l.id, R.serviceKm(s, l)])),
      trackMap = new Map(s.tracks.map(t => [t.id, t])),
      directions = new Map(op.services.map(r => [r.id, new Map(r.trackIds.map((id, i) => [id, trackMap.get(
        id) && r.stops[i] !== trackMap.get(id).a ? -1 : 1]).reverse())])),
      byRun = new Map(op.services.map(r => [r.id, r])),
      data = new Map(s.services.map(l => [l.id, {
        demand: new Map(),
        usage: {},
        riders: 0,
        long: 0,
        transfers: {}
      }]));
    for (const f of forecast.flows || []) {
      const amount = (f.demandTrips ?? f.trips) * Q.factor(s, f),
        seen = new Set(),
        seenRuns = new Set(),
        lineDistance = {};
      for (const e of f.path.edges) {
        const run = byRun.get(e.service),
          id = run?.parentLine || e.service,
          d = data.get(id);
        if (!d) continue;
        seen.add(id);
        lineDistance[id] = (lineDistance[id] || 0) + e.km;
        for (const track of e.tracks || [e.track]) {
          const key = track + ':' + ((directions.get(e.service)?.get(track) || 1) * (e.dir || 1));
          d.demand.set(key, (d.demand.get(key) || 0) + amount);
        }
        if (!seenRuns.has(e.service)) {
          d.usage[e.service] = (d.usage[e.service] || 0) + amount;
          seenRuns.add(e.service);
        }
      }
      for (const id of seen) {
        const d = data.get(id),
          km = lineKm.get(id);
        d.riders += amount;
        if (lineDistance[id] >= km * .6) d.long += amount;
        for (const other of seen)
          if (other !== id) d.transfers[other] = (d.transfers[other] || 0) + amount;
      }
    }
    const lineStats = N.allStats(s, forecast);
    const rows = s.services.map(l => {
      const d = data.get(l.id),
        stats = lineStats.get(l.id),
        loop = l.stops[0] === l.stops.at(-1),
        ps = X.patterns(l),
        peakCap = capacity(s, l, 480, peakOp),
        offCap = capacity(s, l, 720, offOp),
        peakLoad = peakRatio(d.demand, peakCap, PEAK),
        offLoad = peakRatio(d.demand, offCap, OFF),
        beforePeak = l.dispatch.mode === 'auto' ? l.dispatch.peak : l.dispatch.manual,
        beforeOff = l.dispatch.mode === 'auto' ? l.dispatch.offPeak : l.dispatch.manual,
        min = ps.length * 2,
        fullCycle = loop ? X.duration(s, l) * X.directions(l).length : 2 * (X.duration(s, l) + 1),
        maxDemand = Math.max(0, ...d.demand.values()),
        desired = (share, interval) => Math.min(80, Math.max(min, even(fullCycle * Math.max(60 /
          interval, maxDemand * share / (R.capacity(l) * TARGET)) / 60))),
        idealPeak = desired(PEAK, 8),
        idealOff = Math.min(idealPeak, desired(OFF, 12)),
        available = Math.max(0, Math.min(80, Math.floor(F.free(s, l.stockSpec, l.id) / 2) * 2)),
        targetPeak = available < min ? 0 : Math.min(idealPeak, available),
        targetOff = available < min ? 0 : Math.min(idealOff, available),
        trains = (rt.trains || []).filter(t => (t.parentLine || t.service) === l.id),
        maxLoad = Math.max(0, ...trains.map(t => t.onboard / Math.max(1, t.capacity))),
        meanLoad = trains.length ? trains.reduce((v, t) => v + t.onboard / t.capacity, 0) / trains
        .length : null,
        waiting = Object.entries(rt.nativeView?.queues || rt.queues || {}).reduce((v, [k, q]) => v + ((byRun.get(k.split('|')[0])
            ?.parentLine || k.split('|')[0]) === l.id ? Object.values(q).reduce((a, b) => a + b, 0) :
          0), 0),
        outside = [...new Set(l.stops)].reduce((v, id) => v + Object.values((rt.nativeView?.outside || rt.outside)?.[id] || {})
          .reduce((a, b) => a + b, 0), 0),
        m = minute % 1440,
        open = m >= l.open && m < l.close,
        r = Q.line(s, l.id),
        evidence = d.demand.size > 0,
        suggestions = [];
      const add = (type, title, reason, priority, extra = {}) => suggestions.push({
        key: l.id + ':' + type,
        type,
        title,
        reason,
        priority,
        ...extra
      });
      if (evidence && (idealPeak > beforePeak || idealOff > beforeOff)) add('add', '建议增加投放',
        `最忙断面高峰需求约 ${Math.round(maxDemand*PEAK)} 人/小时；按80%负荷及高峰8分钟、平峰12分钟服务目标，高峰 ${beforePeak}→${idealPeak} 列、平峰 ${beforeOff}→${idealOff} 列。`,
        peakLoad > 1 ? 95 : 72, {
          action: 'dispatch'
        });
      if (evidence && ((beforeOff > idealOff && offLoad < .45) || (beforePeak > idealPeak && peakLoad <
          .45)) && !(open && maxLoad > .85 && waiting > 0)) add('reduce', '可收回富余配车',
        `预测最忙断面高峰 ${Math.round(peakLoad*100)}%、平峰 ${Math.round(offLoad*100)}%；建议平峰 ${beforeOff}→${idealOff} 列，高峰 ${beforePeak}→${idealPeak} 列。`,
        55, {
          action: 'dispatch'
        });
      if (open && waiting > 0 && maxLoad >= .9) add('crowd', '实时满载并积压',
        `在线最高满载 ${Math.round(maxLoad*100)}%，本线站台候车 ${Math.round(waiting)} 人；优先检查积压区段与交路分配。`, 100, {
          action: 'review'
        });
      if (open && outside > 0) add('station', '共站站外排队',
        `本线所经车站合计有 ${Math.round(outside)} 人在站外等候，可能涉及其他线路；请检查具体车站及换乘瓶颈。`, 85, {
          action: 'review'
        });
      if (idealPeak > available && evidence) add('stock', '兼容库存不足',
        `${l.stockSpec} 最多可配属 ${available} 列，建议高峰 ${idealPeak} 列，缺口 ${idealPeak-available} 列；可先收回其他线路闲置配属。`,
        82, {
          action: 'buy',
          qty: idealPeak - available
        });
      const seenPatterns = new Map();
      let removal = false;
      ps.forEach((p, i) => {
        const key = JSON.stringify([p.kind, p.from, p.to, p.calls, p.target, p.targetEnd]);
        if (seenPatterns.has(key) && !removal) {
          const next = clone(ps);
          next.splice(i, 1);
          const sum = next.reduce((v, p) => v + p.fleet, 0);
          next[0].fleet += Math.max(0, l.fleet - sum);
          add('duplicate', '可合并重复交路',
            `第 ${i+1} 个交路与第 ${seenPatterns.get(key)+1} 个停站、端点完全相同，可合并以简化调度。`, 64, {
              action: 'pattern',
              patterns: next
            });
          removal = true;
        }
        seenPatterns.set(key, i);
      });
      const runUsage = op.services.filter(r => r.parentLine === l.id).map(run => ({
          run,
          amount: d.usage[run.id] || 0
        })),
        usageTotal = runUsage.reduce((v, x) => v + x.amount, 0);
      if (!removal && ps.length > 1 && usageTotal > 1000) {
        const full = ps.findIndex(p => p.kind === 'local' && p.from === 0 && p.to === l.stops.length -
            1),
          low = runUsage.find(x => x.run.patternIndex !== full && ps[x.run.patternIndex].kind !==
            'cross' && x.amount / usageTotal < .05);
        if (full >= 0 && low) {
          const next = clone(ps);
          next.splice(low.run.patternIndex, 1);
          next[full > low.run.patternIndex ? full - 1 : full].fleet += ps[low.run.patternIndex].fleet;
          add('low-pattern', '复核低使用交路',
            `第 ${low.run.patternIndex+1} 个交路仅占本线交路使用量 ${(low.amount/usageTotal*100).toFixed(1)}%；保留全程普通车，先评估合并。`,
            48, {
              action: 'pattern',
              patterns: next
            });
        }
      }
      const segments = l.trackIds.map((id, i) => ({
          id,
          i,
          from: l.stops[i],
          to: l.stops[i + 1],
          demand: Math.max(d.demand.get(id + ':1') || 0, d.demand.get(id + ':-1') || 0)
        })),
        top = Math.max(0, ...segments.map(x => x.demand)),
        hot = segments.filter(x => x.demand >= top * .65 && x.demand > 0),
        first = hot[0]?.i,
        last = hot.at(-1)?.i;

      function appendPattern(p) {
        if (ps.length >= 8) return null;
        const next = clone(ps),
          donor = next.find(x => x.fleet >= 4);
        if (!donor || Math.min(beforeOff, beforePeak) < (ps.length + 1) * 2) return null;
        donor.fleet -= 2;
        next.push({
          ...p,
          fleet: 2,
          headway: l.headway
        });
        return next;
      }
      if (!loop && segments.length >= 5 && hot.length && last - first + 1 <= segments.length * .7 &&
        peakLoad > .75 && !ps.some(p => p.kind === 'short')) {
        const draft = appendPattern({
          kind: 'short',
          from: first,
          to: last + 1
        });
        add('short', '考虑增加小交路',
          `「${s.nodes[l.stops[first]].name}—${s.nodes[l.stops[last+1]].name}」集中主要断面需求，外段较弱；小交路可把车辆集中到繁忙区间。`,
          67, {
            action: draft ? 'pattern' : 'review',
            patterns: draft
          });
      }
      if (!loop && stats.km >= 20 && l.stops.length >= 8 && d.riders > 1000 && d.long / d.riders >=
        .35 && !ps.some(p => ['express', 'direct'].includes(p.kind))) {
        const ranked = [...new Set(l.stops)].sort((a, b) => ((stats.stations[b]?.board || 0) + (stats
            .stations[b]?.alight || 0)) - ((stats.stations[a]?.board || 0) + (stats.stations[a]
            ?.alight || 0))),
          calls = new Set([l.stops[0], l.stops.at(-1), ...ranked.slice(0, Math.min(4, Math.floor(l.stops
            .length / 2)))]);
        const draft = appendPattern({
          kind: 'express',
          from: 0,
          to: l.stops.length - 1,
          calls: [...calls]
        });
        add('express', '考虑快速交路',
          `约 ${Math.round(d.long/d.riders*100)}% 本线出行跨越六成以上里程；快速车草案保留两端及主要客流站，全程普通车继续覆盖其余车站。`, 50, {
            action: draft ? 'pattern' : 'review',
            patterns: draft
          });
      }
      if (!evidence) add('observe', '等待需求形成', `当前预测中没有可分配到本线的OD路径，暂不据此减车；检查投放、目的地接驳和线路连通性。`, 30, {
        action: 'review'
      });
      if (r.satisfaction < .6) add('quality', '服务满意度偏低',
        `满意度 ${Math.round(r.satisfaction*100)} 分；查看候车、票价、覆盖和拥挤分项，避免只靠加车处理全部问题。`, 60, {
          action: 'review'
        });
      suggestions.sort((a, b) => b.priority - a.priority);
      return {
        id: l.id,
        l,
        stats,
        suggestions,
        priority: suggestions[0]?.priority || 0,
        demand: evidence,
        sectionDemand: [...d.demand],
        maxDemand,
        peakLoad,
        offLoad,
        segments,
        runUsage: runUsage.map(x => ({
          id: x.run.id,
          kind: x.run.patternKind,
          share: usageTotal ? x.amount / usageTotal : 0
        })),
        beforePeak,
        beforeOff,
        idealPeak,
        idealOff,
        targetPeak,
        targetOff,
        available,
        shortage: Math.max(0, idealPeak - available),
        dispatch: dispatchValues(l, targetOff, targetPeak),
        online: trains.length,
        maxLoad,
        meanLoad,
        waiting,
        outside,
        open,
        satisfaction: r.satisfaction ?? null,
        signature: signature(l)
      };
    });
    return rows.sort((a, b) => b.priority - a.priority || b.stats.riders - a.stats.riders);
  }

  function preview(s, row) {
    if (row.shortage && row.targetOff === row.beforeOff && row.targetPeak === row.beforePeak) return {
      error: '兼容库存只够维持当前投放，请先收回其他线路配属或购车，再审核加车方案。'
    };
    if (!row.dispatch) return {
      error: '现有交路数量所需的最低配车不足。'
    };
    const after = clone(s),
      result = N.configure(after, row.id, row.dispatch);
    if (result.error) return result;
    const l = after.services.find(l => l.id === row.id);
    return {
      values: row.dispatch,
      offPeak: row.targetOff,
      peak: row.targetPeak,
      peakRatio: peakRatio(new Map(row.sectionDemand), capacity(after, l, 480), PEAK),
      signature: row.signature
    };
  }
  const api = {
    analyze,
    preview,
    signature,
    dispatchValues,
    resize,
    capacity,
    peakRatio,
    PEAK,
    OFF,
    TARGET
  };
  if (node) module.exports = api;
  else root.RailOperationsCenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
