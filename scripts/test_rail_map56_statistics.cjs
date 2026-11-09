/* Native statistics lifetime and minute-window projections against frozen MAP55. */
const assert=require('node:assert/strict');
const P=require('../rail/passengers'),M=require('../rail/management'),Q=require('../rail/ridership'),D=require('../rail/demand-model');
const OldP=require('./fixtures/rail-map55-passengers.cjs'),OldM=require('./fixtures/rail-map55-management.cjs'),OldQ=require('./fixtures/rail-map55-ridership.cjs');
const {create}=require('./fixtures/rail-memory-grid.cjs');
const options={budget:1e6,maxSteps:10000,now:()=>0};
const exact=(a,b)=>{assert.deepEqual(a,b);assert.equal(JSON.stringify(a),JSON.stringify(b));};
function forecast(s,populated){
 const cells=s.nodes.map((n,i)=>({id:'c'+i,x:n.x,y:n.y,w:8,h:8,area:.13,people:populated?3000+i*200:0,jobs:populated?1500+i*100:0,shops:populated?500:0,industry:0,leisure:0}));
 return D.evaluate(s,{cells,totals:Object.fromEntries(['people','jobs','shops','industry','leisure'].map(k=>[k,cells.reduce((n,c)=>n+c[k],0)])),metadata:{effectiveConnections:true,demandZoneUnits:40}});
}
(async()=>{
 let checks=0,maxFull=0;
 for(const start of [479.85,1859.85])for(const populated of [false,true])for(const weighted of [false,true]){
  const s=create(3),f=forecast(s,populated);
  s.ridership.hour=[{minute:start-60.001,count:2},{minute:start-60,count:3},{minute:start-59.99,count:4},{minute:start-10,count:5},{minute:start-80,count:6}];
  const old=structuredClone(s),rt=P.create(s,f,start,false);let before=OldP.create(old,f,start,false);
  s.economy.minute=old.economy.minute=start;
  if(weighted)rt.arrivalMode=before.arrivalMode='weighted';
  P.nativeViews(rt);OldP.nativeViews(before);
  try{
   for(const dt of [.3,15,45,30,30]){
    const a=await M.advanceBudgetAsync(s,rt,dt,options),b=await OldM.advanceBudgetAsync(old,before,dt,options);
    exact(a,b);exact(s,old);exact(await P.snapshotAsync(rt),await OldP.snapshotAsync(before));checks++;
   }
   const stable=Q.nativeStatisticsDiagnostics(s);maxFull=Math.max(maxFull,stable.fullFrames);
   assert(stable.fullFrames<=3,JSON.stringify(stable));
   // Public external statistics calls still invalidate the frame and preserve direct field edits.
   s.ridership.current.completed+=.25;old.ridership.current.completed+=.25;
   const trip={lineIds:[],fare:0,byLine:{}};
   Q.event(s,rt,trip,'enter',.25);OldQ.event(old,before,trip,'enter',.25);
   // MAP55 can continue with stale native statistics after an external write.
   // Its documented full-save recovery supplies the expected refreshed state.
   const saved=await OldP.snapshotAsync(before);OldP.dispose(before);before=OldP.restore(old,f,saved);assert(before);before.demandStatus.updatedAt=saved.demandStatus.updatedAt;OldP.nativeViews(before);
   await M.advanceBudgetAsync(s,rt,.4,options);await OldM.advanceBudgetAsync(old,before,.4,options);
   exact(s,old);exact(await P.snapshotAsync(rt),await OldP.snapshotAsync(before));checks++;
   assert(Q.nativeStatisticsDiagnostics(s).fullFrames>stable.fullFrames);
  }finally{P.dispose(rt);OldP.dispose(before);}
 }
 console.log(`MAP56 statistics: ${checks} exact complete worlds/saves; integer/weighted, empty/populated, unsorted expired buckets, exact 60-minute cutoff, quiet expiry, 07:00 archive and external edits; at most ${maxFull} full frames across 120 game minutes.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
