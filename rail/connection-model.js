/* Destination-limited activity budgets. Parameters are explicit game assumptions. */
(function(root) {
  'use strict';
  const VERSION = 36,
    CAPACITY = {
      work: .95,
      shopping: 1.8,
      leisure: 1.5
    },
    FIELDS = {
      work: 'jobs',
      shopping: 'shops',
      leisure: 'leisure'
    },
    RATES = {
      work: .52,
      shopping: .16,
      leisure: .12
    };

  const kernels = () => typeof module !== 'undefined' && module.exports ? require('./demand-kernels') : root.RailDemandKernels;
  const budgets = city => kernels().budgets(city);
  const visitorBudget = (city,total) => kernels().visitorBudget(city,total);
  const capRows = (matrix,rows,n) => kernels().capRows(matrix,rows,n);
  const reserveExternal = (allocations,zones,reachable) => kernels().reserveExternal(allocations,zones,reachable);

  function summarize(s, model) {
    const node=typeof module!=='undefined'&&module.exports,Compact=node?require('./forecast-catalog'):root.RailForecastCatalog,
      TX=node?require('./transactions-wasm'):root.RailTransactions,dto=Compact.source(model),flows=[];
    if(dto){let at=0;const d=dto.flowData,purposes=['work','shopping','leisure'],kinds=['visitor-arrival','visitor-return','staff-outbound','staff-homebound','local-departure','local-return'];
      for(let i=0;i<dto.count;i++){const h=d.subarray(at,at+24);at+=24;const lines=[];for(let n=0;n<h[23];n++)for(const p of dto.graph.edges[d[at++]].parts||[])lines.push(p.line);
        flows.push([h[0],h[1],purposes[h[2]],!!h[3],h[5],h[19]+h[7],h[10]<0?null:dto.hubs[h[10]],h[22],h[12],h[11]<0?null:kinds[h[11]],lines]);at+=1+d[at]*2;}
    }else for(const f of model.flows)flows.push([f.from,f.to,f.purpose,f.back,f.demandTrips??f.trips,f.path.minutes+f.walk,f.hub,f.path.transfers,f.routeOptions,f.externalKind,f.path.edges.flatMap(e=>(e.parts||[]).map(p=>p.line))]);
    return TX.run(30,{services:s.services.map(l=>({id:l.id,stops:l.stops})),stations:model.catchment.stations,flows});
  }

  const api = {
    VERSION,
    CAPACITY,
    FIELDS,
    RATES,
    budgets,
    capRows,
    visitorBudget,
    reserveExternal,
    summarize
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RailConnections = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
