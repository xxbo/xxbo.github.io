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
  const native = () => node ? require('./assets-wasm') : root.RailAssets;
  function upgrade(s) { native().mutate(s,'fleetUpgrade'); return s; }

  let temporalModule;
  const temporal = () => temporalModule || (temporalModule = node ? require('./temporal-wasm') :
    root.RailTemporal);
  const peak = minute => temporal().peak(minute);
  const planned = (l, minute = 420) => temporal().planned(l, minute);
  const allocations = (l, minute = 420) => temporal().allocations(l, minute);

  const recommend = (s,l,daily=0) => native().query(s,'recommend',{line:l,daily});
  const reserved = (s,spec,except) => native().query(s,'reserved',{spec,except});
  const free = (s,spec,except) => native().query(s,'free',{spec,except});
  const validLine = l => native().query({},'validLine',{line:l});
  const validate = s => native().query(s,'validateFleet');
  const purchase = (s,spec,n) => native().mutate(s,'purchase',{spec,count:n});
  const value = s => native().query(s,'vehicleValue');
  function configure(l,d) {
    const out=native().run({},'configureFleet',{line:l,dispatch:d});
    if(!out.result?.error)Object.assign(l,out.line);
    return out.result;
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
