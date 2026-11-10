/* Structured asset commands and generic projections. Rules execute in Rust. */
(function(root) {
  'use strict';
  const node=typeof module!=='undefined'&&module.exports;
  const modules=()=>({Editor:node?require('./editor-wasm'):root.RailEditor,T:node?require('./transactions-wasm'):root.RailTransactions});
  function snapshot(s) {
    const {Editor}=modules(),v=Editor.snapshot(s);
    if(Object.hasOwn(s,'economy'))v.economy=s.economy;else delete v.economy;
    if(s.urban){v.urban={};for(const k of ['version','revision','step','lastMinute','started','facilities','nextId','facilityMode'])if(Object.hasOwn(s.urban,k))v.urban[k]=s.urban[k];}
    return v;
  }
  const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]));
  function projection(s,op) {
    if(['validLine','configureFleet'].includes(op))return {};
    if(op==='facilityValue')return {urban:{facilities:s.urban?.facilities?.map(f=>pick(f,['kind','level','system']))}};
    if(op==='purchase')return {depot:s.depot};
    if(op==='reserved'||op==='free')return {depot:s.depot,services:s.services?.map(l=>pick(l,['id','fleetManaged','stockSpec','fleet']))};
    if(op==='vehicleValue'||op==='validateFleet'||op==='fleetUpgrade')return pick(s,['routeModel','depot','services']);
    if(op==='validateEconomy')return {economy:s.economy};
    if(op==='recommend')return {depot:s.depot,services:s.services?.map(l=>pick(l,['id','fleetManaged','stockSpec','fleet'])),tracks:s.tracks?.map(t=>pick(t,['id','km']))};
    if(['plan','upgradeFacility','removeFacility'].includes(op))return pick(snapshot(s),['world','economy','urban']);
    return snapshot(s);
  }
  function run(s,op,args={},extra={}) {
    const {Editor,T}=modules();Editor.ensure();
    const out=T.run(40,{state:projection(s,op),op,args,...extra});
    if(Object.hasOwn(out.result||{},'insufficient'))out.result={error:'余额不足。当前建设需要 '+(out.result.insufficient*.05/1e4).toFixed(1)+' 万元人民币，请缩短线路或申请贷款。'};
    return out;
  }
  function apply(s,patch=[]) {
    for(const [key,mode,value] of patch){
      if(mode===0)continue;
      const next=mode===1?value.map(row=>row[0]>=0?s[key][row[0]]:row[1]):value;
      if(key==='urban'&&s.urban)Object.assign(s.urban,next);else s[key]=next;
    }
  }
  const facilityCache=new WeakMap();
  function query(s,op,args={}) {
    if(op!=='facilityValue')return run(s,op,args).result;
    const rows=s.urban?.facilities||[],old=facilityCache.get(s);
    if(old&&old.rows.length===rows.length&&rows.every((f,i)=>['kind','level','system'].every(k=>Object.is(f[k],old.rows[i][k]))))return old.result;
    const result=run(s,op,args).result;
    facilityCache.set(s,{rows:rows.map(f=>pick(f,['kind','level','system'])),result});return result;
  }
  function mutate(s,op,args={}) {const out=run(s,op,args);if(!out.result?.error)apply(s,out.patch);return out.result;}
  function transaction(s,command,commit,after,result) {
    const candidate=after||JSON.parse(JSON.stringify(s));
    let state=snapshot(after?s:candidate);
    if(command?.kind==='fleet')state=pick(state,['services','depot','economy']);
    if(command?.kind==='facility')state=pick(state,['world','urban','economy']);
    const out=run(s,command?'transaction':'finalize',{}, {state,command,commit,accounts:s.economy===undefined?undefined:JSON.parse(JSON.stringify(s.economy)),...(after?{after:snapshot(after),result}:{})});
    if(out.result?.error)return out.result;
    apply(candidate,out.patch);
    return {...out.quote,result:out.result,after:candidate};
  }
  const api={snapshot,run,apply,query,mutate,transaction};
  if(node)module.exports=api;else root.RailAssets=api;
})(typeof globalThis!=='undefined'?globalThis:this);
