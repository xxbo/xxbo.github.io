const assert=require('node:assert/strict'),P=require('../rail/passengers'),M=require('../rail/management'),{create}=require('./fixtures/rail-memory-grid.cjs');
(async()=>{
 const s=create(2),l=s.services[0],legs=[{service:l.id,dir:1,from:l.stops[0],to:l.stops.at(-1)}],lineIds=[l.id],byLine={[l.id]:1};
 const catalog=Array.from({length:151056},(_,id)=>({id,legs,daily:0,fare:180,purpose:'work',back:false,hub:null,externalKind:null,from:l.stops[0],to:l.stops.at(-1),lineIds,byLine}));
 for(const line of s.services)assert(!require('../rail/network').configure(s,line.id,{open:600}).error);
 const rt=P.create(s,{preparedDefinitions:catalog},480,false);P.nativeViews(rt);s.economy.minute=480;
 try {
  const result=await M.advanceBudgetAsync(s,rt,1.2,{budget:1e6,maxSteps:10000,now:()=>0});
  assert(result.running);assert.equal(result.steps,12);assert(rt.minute>481);
  const status=require('../rail/simulation-wasm').demandStatus(catalog);assert(status.managed);assert.equal(status.reads,catalog.length);
  const before=status.reads;await M.advanceBudgetAsync(s,rt,1,{budget:1e6,maxSteps:10000,now:()=>0});
  assert.equal(require('../rail/simulation-wasm').demandStatus(catalog).reads,before);
  assert.equal(P.summary(rt).generated,0);assert(Object.is(P.summary(rt).onboard,0),'empty onboard count is positive zero');assert.equal(Object.keys(rt.queues).length,0);
  assert.equal((await P.snapshotAsync(rt)).generated,0);
  console.log('MAP53 large catalog: 151056 profiles, cold native calendar, transferable metadata without spread/stack overflow, no unchanged-minute scans.');
 }finally{P.dispose(rt);}
})().catch(e=>{console.error(e);process.exitCode=1;});
