const assert=require('node:assert/strict');
const P=require('../rail/passengers'),M=require('../rail/management'),N=require('../rail/network'),Core=require('../rail/routing-wasm');
const OldP=require('./fixtures/rail-map52-passengers.cjs'),OldM=require('./fixtures/rail-map52-management.cjs');
const {create}=require('./fixtures/rail-memory-grid.cjs');
const opts={budget:1e6,maxSteps:10000,now:()=>0};
(async()=>{
 let checks=0;
 for(const weighted of [false,true]) {
  const s=create(3),old=structuredClone(s),l=s.services[0];
  const catalog=Array.from({length:30},(_,id)=>({id,legs:[{service:l.id,dir:1,from:l.stops[0],to:l.stops.at(-1)}],daily:300000+id*1000,fare:180+id,purpose:['work','shopping','leisure'][id%3],back:!!(id%2),hub:null,externalKind:null,from:l.stops[0],to:l.stops.at(-1),lineIds:[l.id],byLine:{[l.id]:1}}));
  require('../rail/urban-growth').init(s);require('../rail/urban-growth').init(old);
  const f={preparedDefinitions:catalog,flows:[]};let rt=P.create(s,f,530,false),expected=OldP.create(old,structuredClone(f),530,false);
  s.economy.minute=old.economy.minute=530;if(weighted)rt.arrivalMode=expected.arrivalMode='weighted';
  for(const r of [rt,expected])for(const k of Object.keys(r.stationLimits))r.stationLimits[k]={capacity:30,outsideCapacity:25};
  P.nativeViews(rt);
  try {
   for(const dt of [1,2.3,6.7,.1,15.2,4.3]) {
    await M.advanceBudgetAsync(s,rt,dt,opts);OldM.advanceBudget(old,expected,dt,opts);
    assert.deepEqual(s,old,'world at '+rt.minute);
    const snap=await P.snapshotAsync(rt);
    assert.deepEqual(snap,OldP.snapshot(expected),'snapshot at '+rt.minute);
    assert.deepEqual(P.summary(rt),OldP.summary(expected));
    assert.equal(Object.keys(rt.queues).length,0,'no main-thread queue cohorts');
    assert.equal(rt.transfers.length,0);assert(rt.trains.every(t=>Object.keys(t.passengers).length===0));
    for(const id of l.stops)assert.deepEqual(await P.detailsAsync(rt,'station',id),OldP.station(expected,id));
    for(const t of rt.trains.slice(0,2))assert.deepEqual(await P.detailsAsync(rt,'train',t.id),expected.trains.find(x=>x.id===t.id).passengers);
    assert.throws(()=>P.snapshot(rt),/snapshotAsync/);checks++;
   }
   // Daily edits invalidate a persistent native calendar and update display totals.
   const index=3,previous=rt.demandCatalog[index].daily,value=previous/2;
   P.setDaily(rt,index,value);expected.demandCatalog[index].daily=value;
   expected.demandStatus.daily+=value-previous;expected.demandStatus.updatedAt=expected.minute;
   await M.advanceBudgetAsync(s,rt,2.2,opts);OldM.advanceBudget(old,expected,2.2,opts);
   assert.deepEqual(s,old);assert.deepEqual(await P.snapshotAsync(rt),OldP.snapshot(expected));checks++;
   // A large old directory is compacted only after native cohorts are materialized.
   for(const r of [rt,expected]){const seed=r.defs[0];while(r.defs.length<56001)r.defs.push({...seed,id:r.defs.length,daily:0});}
   await P.materializeAsync(rt);P.rebase(rt,s,f);OldP.rebase(expected,old,structuredClone(f));
   assert(rt.defs.length<100);assert.deepEqual(await P.snapshotAsync(rt),OldP.snapshot(expected));checks++;
   await P.materializeAsync(rt);N.configure(s,l.id,{dispatch:{mode:'auto',manual:8,offPeak:4,peak:8}});N.configure(old,l.id,{dispatch:{mode:'auto',manual:8,offPeak:4,peak:8}});P.reconcile(rt,s);OldP.reconcile(expected,old);
   assert.deepEqual(await P.snapshotAsync(rt),OldP.snapshot(expected),'save immediately after edit, before native rebase');
   await M.advanceBudgetAsync(s,rt,3,opts);OldM.advanceBudget(old,expected,3,opts);assert.deepEqual(await P.snapshotAsync(rt),OldP.snapshot(expected));assert.deepEqual(s,old);checks++;
   const saved=await P.snapshotAsync(rt);const restored=P.restore(s,f,saved);assert(restored);P.dispose(rt);rt=restored;P.nativeViews(rt);
   const oldSaved=OldP.snapshot(expected);expected=OldP.restore(old,structuredClone(f),oldSaved);assert(expected);
   await M.advanceBudgetAsync(s,rt,3,opts);OldM.advanceBudget(old,expected,3,opts);assert.deepEqual(await P.snapshotAsync(rt),OldP.snapshot(expected));assert.deepEqual(s,old);checks++;
  }finally{P.dispose(rt);}
 }
 // Unavailable Worker keeps complete recovery projections on the same Rust kernel.
 const threads=require('node:worker_threads'),Worker=threads.Worker;
 threads.Worker=class{constructor(){throw Error('worker unavailable in this test');}};
 let fallback;
 try {
  const s=create(2),old=structuredClone(s),l=s.services[0];
  const f={preparedDefinitions:[{id:0,legs:[{service:l.id,dir:1,from:l.stops[0],to:l.stops.at(-1)}],daily:20000,fare:180,purpose:'work',back:false,hub:null,externalKind:null,from:l.stops[0],to:l.stops.at(-1),lineIds:[l.id],byLine:{[l.id]:1}}]};
  fallback=P.create(s,f,480,false);const expected=OldP.create(old,structuredClone(f),480,false);
  s.economy.minute=old.economy.minute=480;P.nativeViews(fallback);
  await M.advanceBudgetAsync(s,fallback,4.2,opts);OldM.advanceBudget(old,expected,4.2,opts);
  assert.deepEqual(s,old);assert.deepEqual(P.snapshot(fallback),OldP.snapshot(expected));assert(!fallback.nativeView);checks++;
 }finally{if(fallback)P.dispose(fallback);threads.Worker=Worker;}
 console.log('MAP53 native state:',checks,'complete native-generated snapshots, compact views, station/train queries, edits and JSON restore; integer + weighted crowding.');
})().catch(e=>{console.error(e);process.exitCode=1;});
