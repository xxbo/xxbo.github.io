/* Actual operating-day indicators; never substitute forecasts for observations. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    Q = node ? require('./ridership') : root.RailRidership,
    BAL = node ? require('./game-balance') : root.RailBalance;

  const History = node ? require('./history-wasm') : root.RailHistory;
  const lengths = s => History.lengths(s);

  function records(s) {
    const km = lengths(s);
    return {
      bestNetworkKm: km.networkKm,
      bestLineKm: km.longestKm,
      bestRevenue: s.economy?.revenue || 0,
      totalPassengerKm: s.ridership?.records?.totalPassengerKm || 0
    };
  }

  function daily(s, rt) {
    const q = s.ridership,
      d = q?.current?.number === Q.day(rt.minute) ? q.current : {
        number: Q.day(rt.minute),
        completed: 0,
        boarded: 0,
        lines: {}
      },
      km = lengths(s),
      loads = {};
    for (const t of rt.trains) {
      const id = t.parentLine || t.service,
        r = loads[id] || (loads[id] = {
          onboard: 0,
          capacity: 0,
          trains: 0,
          max: 0
        });
      r.onboard += t.onboard;
      r.capacity += t.capacity;
      r.trains++;
      r.max = Math.max(r.max, t.capacity ? t.onboard / t.capacity : 0);
    }
    const rows = s.services.map(l => {
      const st = d.lines?.[l.id] || {},
        load = loads[l.id],
        revenue = st.revenue || 0,
        operating = st.operating || 0;
      return {
        id: l.id,
        name: l.name,
        color: l.color,
        km: km.byLine[l.id],
        riders: st.boarded || 0,
        completed: st.completed || 0,
        load: load?.capacity ? load.onboard / load.capacity : null,
        maxLoad: load?.max ?? null,
        trains: load?.trains || 0,
        intensity: km.byLine[l.id] ? (st.boarded || 0) / km.byLine[l.id] : 0,
        passengerKm: st.passengerKm || 0,
        revenue,
        grant: revenue * BAL.GRANT_RATE,
        operating,
        profit: revenue * (1 + BAL.GRANT_RATE) - operating
      };
    }).sort((a, b) => b.riders - a.riders || a.name.localeCompare(b.name, 'zh-CN'));
    return {
      day: d.number,
      completed: d.completed || 0,
      boarded: d.boarded || 0,
      networkKm: km.networkKm,
      passengerKm: d.passengerKm || 0,
      revenue: d.revenue || 0,
      operating: d.operating || 0,
      profit: (d.revenue || 0) * (1 + BAL.GRANT_RATE) - (d.operating || 0),
      partial: (d.metricsSince ?? rt.minute) > 420 + (d.number - 1) * 1440 + .01,
      metricsSince: d.metricsSince,
      rows
    };
  }
  const api = {
    daily,
    records,
    lengths
  };
  if (node) module.exports = api;
  else root.RailInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
