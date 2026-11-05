/* Public compatibility facade. Forecast and spatial decisions are owned by Rust/WASM. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const W = node ? require('./demand-world') : root.RailDemandWorld;
  const K = node ? require('./connection-model') : root.RailConnections;
  const KD = node ? require('./demand-kernels') : root.RailDemandKernels;
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

  function evaluate(state,city) {
    const result=W.evaluate(state,city);
    if(city.metadata?.effectiveConnections)result.lineConnections=K.summarize(state,result);
    return result;
  }
  const api={...W,evaluate,ipf:KD.ipf,modeShare:KD.modeShare,strategy:KD.strategy,profiles,MODE_ASSUMPTIONS,ACCESS_WEIGHTS};
  if(node)module.exports=api;else root.RailDemand=api;
})(typeof globalThis!=='undefined'?globalThis:this);
