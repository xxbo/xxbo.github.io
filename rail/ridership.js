/* Stateful demand cultivation, station operating limits and actual-journey records.
   Geometry and adaptation periods are explicit game assumptions, not station certificates. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    X = node ? require('./service-plan') : root.RailServicePlan;
  const BAL = node ? require('./game-balance') : root.RailBalance;
  const FLOW = node ? require('./flow-history') : root.RailFlowHistory;
  const Statistics = node ? require('./statistics-wasm') : root.RailStatistics;
  const Native = node ? require('./operations-wasm') : root.RailNativeOperations;
  const statistics = Statistics.bind({
    ensureDay,
    lineStats,
    day: minute => day(minute)
  });
  const VERSION = 14,
    DAY = 1440,
    ORIGIN = 420,
    SPACE = .93,
    START = .55,
    TAU = 10;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)),
    lines = s => s.baseLines || s.services,
    day = m => Math.max(1, Math.floor((m - ORIGIN + 1e-7) / DAY) + 1);

  function emptyDay(number) {
    return {
      number,
      revenue: 0,
      operating: 0,
      passengerKm: 0,
      metricsSince: ORIGIN + (number - 1) * DAY,
      attempted: 0,
      completed: 0,
      rejected: 0,
      waitMinutes: 0,
      boarded: 0,
      lines: {},
      stations: {}
    };
  }

  function init(s, minute = s.economy?.minute || 420) {
    if (s.routeModel !== 9) return null;
    let q = s.ridership;
    if (!q || q.version !== VERSION || !q.lines || !q.current || !q.records || !Array.isArray(q
        .history) ||
      !Array.isArray(q.hour)) {
      q = s.ridership = {
        version: VERSION,
        lines: {},
        current: emptyDay(day(minute)),
        history: [],
        hour: [],
        records: {
          bestDay: 0,
          bestDayNumber: 0,
          bestHour: 0,
          bestHourMinute: 0,
          totalCompleted: 0
        },
        lastMinute: minute
      };
      for (const l of lines(s)) q.lines[l.id] = {
        opened: minute,
        awareness: 1,
        trust: 1,
        serviceDays: 30,
        migrated: true,
        bestDay: 0,
        attempted: 0,
        lost: 0,
        wait: 0,
        boarded: 0
      };
    }
    if (!Number.isFinite(q.records.totalPassengerKm)) {
      q.records.totalPassengerKm = 0;
      statistics.invalidate(s);
    }
    if (!Number.isFinite(q.current.revenue)) {
      q.current.revenue = 0;
      q.current.operating = 0;
      q.current.passengerKm = 0;
      q.current.metricsSince = minute;
      statistics.invalidate(s);
    }
    if (q.current.number === day(minute)) FLOW.touch(q.current, minute);
    sync(s, minute);
    return q;
  }

  function sync(s, minute = s.economy?.minute || 420) {
    const q = s.ridership;
    if (!q || q.version !== VERSION) return;
    let changed = false;
    for (const l of lines(s))
      if (!q.lines[l.id]) {
        changed = true;
        q.lines[l.id] = {
          opened: minute,
          awareness: START,
          trust: 1,
          serviceDays: 0,
          migrated: false,
          bestDay: 0,
          attempted: 0,
          lost: 0,
          wait: 0,
          boarded: 0
        };
      }
    if (changed) statistics.invalidate(s);
  }
  const WEIGHTS = {
    crowding: .22,
    waiting: .18,
    speed: .15,
    coverage: .15,
    fare: .13,
    reliability: .10,
    hours: .07
  };
  const LABELS = {
    crowding: '拥挤舒适度',
    waiting: '候车与频率',
    speed: '速度与绕行',
    coverage: '目的地覆盖',
    fare: '票价合理性',
    reliability: '服务可靠性',
    hours: '运营时段'
  };

  function enableSatisfaction(s) {
    const q = init(s);
    if (!q) return;
    if (q.model === 22) return;
    q.model = 22;
    for (const r of Object.values(q.lines)) {
      r.satisfaction = .7;
      r.scores = null;
      r.feedbackMinute = null;
    }
  }

  function multiplier(score) {
    return .25 + .75 * clamp(score, 0, 1);
  }

  function feedback(s, rt, l) {
    return Native.feedback(s, rt, 0, false, l);
  }

  function updateSatisfaction(s, rt, minutes = 0) {
    if (s.ridership?.model !== 22) return;
    sync(s, rt.minute);
    Native.feedback(s, rt, minutes, false);
  }

  function factor(s, journey) {
    const q = s.ridership;
    if (!q) return 1;
    const ids = journey.lineIds || Object.keys(journey.path?.fares || {});
    if (!ids.length) return 1;
    return Math.min(...ids.map(id => {
      const l = q.lines[id];
      if (!l) return 1;
      if (q.model === 22) return multiplier(l.satisfaction ?? .7);
      const awareness = journey.hub ? 1 - (1 - l.awareness) * .5 : l.awareness;
      return clamp(awareness * l.trust, 0, 1);
    }));
  }

  function limits(s, id) {
    const ls = lines(s).filter(l => l.stops.includes(id)),
      cars = Math.max(4, ...ls.map(l => l.cars || 6)),
      platforms = Math.max(2, Math.min(6, ls.length * 2)),
      length = Math.max(cars * 20 + 20, ...ls.filter(l => l.fleetManaged).map(l => (
          typeof module !==
          'undefined' && module.exports ? require('./fleet') : root.RailFleet).SPECS[l
          .stockSpec].length +
        20)),
      usableWidth = 3,
      area = length * usableWidth * platforms,
      capacity = Math.floor(area / SPACE);
    return {
      capacity,
      outsideCapacity: Math.floor(capacity * .5),
      platforms,
      length,
      usableWidth,
      area,
      spacePerPerson: SPACE
    };
  }

  function ensureDay(s, minute) {
    const q = s.ridership;
    if (!q) return null;
    const d = day(minute);
    if (q.current.number !== d) {
      const boundary = ORIGIN + (d - 1) * DAY,
        continuous = q.current.flow && q.current.number === d - 1 && q.current.flow.through >=
        boundary - 1;
      if (q.current.flow && q.current.number === d - 1) FLOW.touch(q.current, boundary);
      q.history.push({
        ...q.current,
        maturity: Object.fromEntries(Object.entries(q.lines).map(([id, l]) => [id, l
          .awareness * l
          .trust
        ]))
      });
      q.history = q.history.slice(-30);
      q.current = emptyDay(d);
      if (continuous) FLOW.touch(q.current, boundary);
    }
    FLOW.touch(q.current, minute);
    return q.current;
  }

  function lineStats(d, id) {
    return d.lines[id] || (d.lines[id] = {
      attempted: 0,
      completed: 0,
      rejected: 0,
      boarded: 0,
      waitMinutes: 0
    });
  }

  function station(s, id, minute = s.economy?.minute || 420) {
    const d = s.ridership?.current;
    return d?.number === day(minute) ? {
      entered: 0,
      boarded: 0,
      alighted: 0,
      ...d.stations?.[id]
    } : {
      entered: 0,
      boarded: 0,
      alighted: 0
    };
  }

  const event = (...args) => statistics.event(...args);
  const projectEvents = (s, rt, apply) => apply();

  function step(s, rt, minutes) {
    const q = s.ridership;
    if (!q) return;
    ensureDay(s, rt.minute);
    sync(s, rt.minute);
    Native.feedback(s, rt, minutes, true);
    q.lastMinute = rt.minute;
    q.hour = q.hour.filter(b => b.minute > Math.floor(rt.minute) - 60);
    statistics.invalidate(s);
  }

  function line(s, id) {
    const q = s.ridership?.lines[id];
    return q ? {
      ...q,
      factor: s.ridership.model === 22 ? multiplier(q.satisfaction ?? .7) : q.awareness * q
        .trust
    } : {
      awareness: 1,
      trust: 1,
      serviceDays: 0,
      factor: 1,
      bestDay: 0
    };
  }
  const RECORD_FIELDS = ['bestDay', 'bestHour', 'totalCompleted', 'totalPassengerKm',
    'bestNetworkKm',
    'bestLineKm', 'bestRevenue'
  ];

  function awards(r = {}) {
    const list = [{
      id: 'first100',
      name: '初具人气',
      target: 100,
      value: r.totalCompleted || 0,
      unit: '完成出行',
      suffix: '人次',
      category: '客流'
    }, {
      id: 'day1000',
      name: '城市通勤',
      target: 1000,
      value: r.bestDay || 0,
      unit: '单日完成出行',
      suffix: '人次',
      category: '客流'
    }, {
      id: 'day10000',
      name: '万人线路网',
      target: 10000,
      value: r.bestDay || 0,
      unit: '单日完成出行',
      suffix: '人次',
      category: '客流'
    }, {
      id: 'hour1000',
      name: '高峰承运',
      target: 1000,
      value: r.bestHour || 0,
      unit: '连续60分钟完成出行',
      suffix: '人次',
      category: '客流'
    }];
    const add = (key, category, unit, suffix, tiers) => tiers.forEach(([target, name], i) => list
      .push({
        id: key + i,
        name,
        target,
        value: r[key] || 0,
        category,
        unit,
        suffix
      }));
    add('totalCompleted', '客流', '单局累计完成出行', '人次', [
      [1e5, '十万次抵达'],
      [1e6, '百万旅程']
    ]);
    add('totalPassengerKm', '运输', '单局累计客运周转量', '人公里', [
      [1e4, '穿行城市'],
      [1e5, '十万人公里'],
      [1e6, '百万公里同行']
    ]);
    add('bestNetworkKm', '线网', '最高线网长度', 'km', [
      [10, '初成线网'],
      [50, '城市骨架'],
      [100, '百公里网络'],
      [500, '都市圈动脉']
    ]);
    add('bestLineKm', '线网', '最长单线长度', 'km', [
      [10, '跨区通勤'],
      [30, '城市走廊'],
      [50, '长线贯城']
    ]);
    add('bestRevenue', '收入', '单局累计实际票款', '元', [
      [2e6, '首个十万票款'],
      [2e7, '百万票款'],
      [2e8, '千万票款'],
      [2e9, '亿元票款']
    ]);
    return list.map(a => ({
      ...a,
      displayTarget: a.category === '收入' ? a.target * .05 : a.target,
      displayValue: a.category === '收入' ? a.value * .05 : a.value,
      unlocked: a.value + 1e-7 >= a.target,
      progress: Math.min(1, (a.value || 0) / a.target)
    }));
  }

  function mergeRecords(a = {}, b = {}) {
    return Object.fromEntries(RECORD_FIELDS.filter((k, i) => i < 3 || Number.isFinite(a[k]) ||
      Number
      .isFinite(b[k])).map(k => [k, Math.max(Number.isFinite(a[k]) ? a[k] : 0, Number
      .isFinite(b[k]) ?
      b[k] : 0)]));
  }

  const travel = (...args) => statistics.travel(...args);
  let costCache = null;

  function financeFrame(s, rt) {
    if (!s.ridership) return null;
    const d = ensureDay(s, rt.minute);
    if (!costCache || costCache.services !== s.services || costCache.tracks !== s.tracks) {
      const km = new Map(s.tracks.map(t => [t.id, t.km]));
      const rows = s.services.map(l => [l.id, l.trackIds.reduce((v, id) => v + (km.get(id) || 0),
          0)]),
        total = rows.reduce((v, r) => v + r[1], 0);
      costCache = {
        services: s.services,
        tracks: s.tracks,
        rows: rows.map(([id, length]) => [id, total ? length / total : 0])
      };
    }
    const stats = costCache.rows.map(([id]) => lineStats(d, id));
    return {
      length: stats.length + 1,
      input: [Number(d.operating), ...stats.flatMap((st, i) => [Number(st.operating), costCache
        .rows[i][1]
      ])],
      apply: values => {
        d.operating = values[0];
        for (let i = 0; i < stats.length; i++) {
          stats[i].operating = values[i + 1];
          statistics.financeChanged(s, costCache.rows[i][0], stats[i].operating);
        }
      }
    };
  }

  function finance(s, rt, cost, fixed) {
    const frame = financeFrame(s, rt);
    if (!frame) return;
    const rows = [];
    for (let i = 1; i < frame.input.length; i += 2) rows.push([frame.input[i], frame.input[i +
      1]]);
    frame.apply(Native.allocation(frame.input[0], cost, fixed, rows).subarray(1));
  }

  const api = {
    financeFrame,
    rejectBatch: statistics.rejectBatch,
    nativeStatisticsFrame: statistics.frame,
    nativeStatisticsProjector: statistics.projector,
    projectEvents,
    travel,
    finance,
    RECORD_FIELDS,
    init,
    sync,
    factor,
    limits,
    enableSatisfaction,
    updateSatisfaction,
    feedback,
    multiplier,
    WEIGHTS,
    LABELS,
    step,
    event,
    station,
    line,
    day,
    awards,
    mergeRecords,
    VERSION,
    SPACE,
    START,
    TAU
  };
  if (node) module.exports = api;
  else root.RailRidership = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
