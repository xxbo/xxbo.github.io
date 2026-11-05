/* Object/binary boundary for the complete Rust forecast. No spatial or allocation decisions here. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./routing-wasm') : root.RailRouting;
  const X = node ? require('./service-plan') : root.RailServicePlan;
  const R = node ? require('./engine') : root.RailSim;
  const H = node ? require('./hubs') : root.RailHubs;
  const BAL = node ? require('./game-balance') : root.RailBalance;
  const FIELDS = ['people','jobs','shops','industry','leisure'];
  const PURPOSES = ['work','shopping','leisure'], MODES = ['walk','bike','bus'];
  const KINDS = ['visitor-arrival','visitor-return','staff-outbound','staff-homebound','local-departure','local-return'];
  const tokens = new WeakMap();
  let serial = 0, fixed;
  function cellValues(c) {
    return [c.x,c.y,c.w,c.h,c.area,...FIELDS.map(k => c[k]),c.factory,c.survey,c.populationValid ? 1 : 0];
  }
  function encode(state,city,adj=null) {
    if (!tokens.has(city)) tokens.set(city,++serial);
    const plan = X.expand(state), effective = !!city.metadata?.effectiveConnections;
    const ids = [...new Set(plan.services.filter(l => !effective || l.fleet > 0).flatMap(l => l.callStops || l.stops))];
    const hubs = H.forRegion(state.region), tracks = state.tracks.map(t=>t.id), trackIds = new Map(tracks.map((id,i)=>[id,i]));
    const edges = adj ? adj.flat() : [], runs = adj ? plan.services : [];
    const values = [1,tokens.get(city),+effective,state.urban?1:0,state.urban?.version||0,state.urban?.step||0,
      city.metadata?.demandZoneUnits||80,BAL.HUB_CAPTURE_MAX,BAL.HUB_MARKET_SCALE,
      ...FIELDS.map(k=>city.totals[k]),state.nodes.length,ids.length,city.cells.length,hubs.length,runs.length,tracks.length,edges.length,state.services.length];
    for(const n of state.nodes) values.push(n.x,n.y);
    values.push(...ids);
    for(const c of city.cells) values.push(...cellValues(c));
    for(const h of hubs) {
      const e=H.envelope(h),a=H.access(h);
      values.push(h.x,h.y,e.movements,e.landside,e.visitorArrivals,e.visitorReturns,e.localDepartures,e.localReturns,a.staff||0,a.railReference);
    }
    for(const l of runs) {
      const list=[...new Set(l.trackIds)].map(id=>trackIds.get(id));
      values.push(X.headway(plan,l),R.capacity(l),list.length,...list);
    }
    for(const e of edges) {
      const list=(e.tracks||[e.track]).map(id=>trackIds.get(id));
      values.push(list.length,...list);
    }
    return {values, state,city,hubs,tracks,effective};
  }
  function cursor(data) {
    let at=0;
    return {f(){if(at>=data.length) throw Error('批量预测结果不完整');return data[at++];},
      take(n){if(at+n>data.length)throw Error('批量预测结果尺寸无效');const v=data.subarray(at,at+n);at+=n;return v;},
      done(){if(at!==data.length)throw Error('批量预测结果含多余数据');}};
  }
  function fields(r,keys){return Object.fromEntries(keys.map(k=>[k,r.f()]));}
  function readCatchment(r,city) {
    const [covered,accessible,total,count]=r.take(4), stations={}, mapping=new Map();
    for(let i=0;i<count;i++){const id=r.f();stations[id]=fields(r,[...FIELDS,'walk','cells']);}
    const maps=r.f();
    for(let i=0;i<maps;i++) {
      const [cellIndex,id,walk,n]=r.take(4), access=[];
      for(let j=0;j<n;j++) {
        const id=r.f(),mode=MODES[r.f()];
        access.push({id,mode,...fields(r,['share','walk','time','accessCost','x','y'])});
      }
      mapping.set(city.cells[cellIndex].id,{id,walk,access});
    }
    return {stations,mapping,covered,accessible,total};
  }
  function readBudgets(r,matched) {
    return Object.fromEntries(PURPOSES.map(k=>{const [nominal,capacity,outbound,m]=r.take(4);return [k,{nominal,capacity,outbound,...(matched?{matched:m}:{})}];}));
  }
  function assign(state,city) {
    const e=encode(state,city), out=Core.kernel('world_run',[0,...e.values]);
    const r=cursor(out), result=readCatchment(r,city);r.done();return result;
  }
  function choices(p,stations,feeders=true) {
    const values=[3,p.x,p.y,+feeders,stations.length];
    for(const n of stations)values.push(n.id,n.x,n.y);
    const r=cursor(Core.kernel('world_run',values)), result=[],n=r.f();
    for(let i=0;i<n;i++){
      const [id,km,time,mode,accessCost,weight,share]=r.take(7);
      result.push({id,km,time,mode:MODES[mode],accessCost,weight,share});
    }
    r.done();return result;
  }
  function local(city,p,radius=.8) {
    const values=[2,p.x,p.y,radius,city.cells.length];
    for(const c of city.cells)values.push(...cellValues(c));
    const r=cursor(Core.kernel('world_run',values));
    const out=fields(r,[...FIELDS,'cells','area','factory','surveyArea','populationArea']);r.done();return out;
  }
  function distribution(city) {
    if(fixed?.city===city)return fixed;
    const state={nodes:[],services:[],tracks:[],companies:[],region:city.metadata?.region};
    const e=encode(state,city),r=cursor(Core.kernel('world_run',[1,...e.values])),n=r.f(),zones=[];
    for(let i=0;i<n;i++){
      const [bx,by]=r.take(2),z={key:bx+':'+by,...fields(r,['x','y','count','area',...FIELDS])},count=r.f();
      z.cells=Array.from(r.take(count),ix=>city.cells[ix]);zones.push(z);
    }
    const budgets=readBudgets(r,true),[ipfError,ipfIterations]=r.take(2);r.take(3);
    const matrices=Object.fromEntries(PURPOSES.map(p=>[p,r.take(n*n)]));r.done();
    fixed={city,zones,matrices,diagnostics:{ipfError,ipfIterations,...(e.effective?{activityBudgets:budgets}:{})}};
    return fixed;
  }
  function readStats(r){const o=fields(r,['entries','limit','peak','hits','misses','evictions','weight','maxWeight','peakWeight','oversized']);if(!Number.isFinite(o.maxWeight))o.maxWeight=null;return o;}
  function readForecast(data,context) {
    const {state:s,city,hubs,tracks,effective,graph,started}=context,r=cursor(data);
    if(r.f()!==1)throw Error('批量预测接口版本不匹配');
    const populated=!!r.f();r.f();
    const [totalTrips,uncoveredTrips,riders,unserved,work,shopping,leisure,connectedDemand,eligiblePairs,zones,ipfError,ipfIterations]=r.take(12);
    const activityBudgets=readBudgets(r,populated),catchment=readCatchment(r,city);
    const base={city:true,flows:[],trackFlow:{},trackLoad:{},serviceFlow:{},riders,unserved,totalTrips,uncoveredTrips,
      purposeTotals:{work,shopping,leisure},catchment,population:city.totals.people,jobs:city.totals.jobs,hubStats:{},connectionModel:effective?36:null,
      diagnostics:{model:effective?'effective-connections-v36':s.urban?'transit-urban-growth-v19':'hub-corridor-progression-v17',...(effective?{activityBudgets}:{})}};
    const nh=r.f();
    for(let i=0;i<nh;i++) {
      const [marketActivation,riders,arrivals,departures,staffRiders,passengerRiders,visitorDestinationScale,visitorDestinationCapacity,corridorCapture,corridorMass,development,n]=r.take(12);
      const h=hubs[i],env=H.envelope(h),railReference=H.access(h).railReference,connections=[];
      for(let j=0;j<n;j++){const[id,walk,share]=r.take(3);connections.push({id,walk,share});}
      base.hubStats[h.id]={...env,railReference,referenceTarget:env.landside*railReference,marketActivation,riders,arrivals,departures,staffRiders,passengerRiders,connections,
        ...(populated&&effective?{visitorDestinationScale,visitorDestinationCapacity}:{}),...(populated?{corridorCapture,corridorMass,development}:{})};
    }
    for(const [key,ids] of [['trackFlow',tracks],['trackLoad',tracks],['serviceFlow',graph.lines]]){
      const n=r.f();for(let i=0;i<n;i++){const id=r.f();base[key][ids[id]]=r.f();}
    }
    const nf=r.f();
    for(let i=0;i<nf;i++){
      const [from,to,purpose,back,trips,demandTrips,population,walk,rail,road,hub,kind,routeOptions]=r.take(13);
      const [service,dir,lastLine,fareKm,board,cost,minutes,fare,km,transfers,ne]=r.take(11);
      const edges=Array.from(r.take(ne),ix=>graph.edges[ix]),nfare=r.f(),fares={};
      for(let j=0;j<nfare;j++){const id=r.f();fares[graph.lines[id]]=r.f();}
      const path={service:graph.services[service],dir,lastLine:graph.lines[lastLine],fareKm,board,cost,minutes,fare,km,edges,transfers,fares};
      base.flows.push({from,to,purpose:PURPOSES[purpose],back:!!back,trips,demandTrips,path,population,walk,rail,road,hub:hub<0?null:hubs[hub].id,externalKind:kind<0?null:KINDS[kind],...(effective?{routeOptions}:{})});
    }
    if(populated){
      const routeTrees=readStats(r),strategies=readStats(r);
      Object.assign(base.diagnostics,{ipfError,ipfIterations,connectedDemand,railDemand:base.flows.reduce((v,f)=>v+f.demandTrips,0),zones,eligiblePairs,
        calculationMs:Date.now()-started,accessSampling:16,memory:{routeTrees,strategies,routing:'rust-wasm-abi1',demand:'rust-wasm-forecast-abi1',wasm:Core.status()}});
    }
    r.done();return base;
  }
  function evaluate(state,city){const started=Date.now(),adj=X.network(state),e=encode(state,city,adj);return Core.forecastKernel(state,adj,e.values,readForecast,{...e,started});}
  const api={assign,local,choices,distribution,evaluate};
  if(node)module.exports=api;else root.RailDemandWorld=api;
})(typeof globalThis!=='undefined'?globalThis:this);
