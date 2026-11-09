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
    const result=History.daily(s,rt,BAL.GRANT_RATE),lines=new Map(s.services.map(l=>[l.id,l]));
    result.rows=result.rows.map(({id,...values})=>({id,name:lines.get(id).name,color:lines.get(id).color,...values})).sort((a,b)=>b.riders-a.riders||a.name.localeCompare(b.name,'zh-CN'));
    return result;
  }

  const api = {
    daily,
    records,
    lengths
  };
  if (node) module.exports = api;
  else root.RailInsights = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
