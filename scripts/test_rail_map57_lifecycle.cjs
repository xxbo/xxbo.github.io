const assert=require('node:assert/strict'),P=require('../rail/passengers'),M=require('../rail/management'),N=require('../rail/network'),Q=require('../rail/ridership');
const OldP=require('./fixtures/rail-map56-passengers.cjs'),OldM=require('./fixtures/rail-map56-management.cjs');
const options={budget:1e6,maxSteps:10000,now:()=>0};
(async()=>{
 const s=M.init(N.emptyWorld('gba'));Q.enableSatisfaction(s);s.ridership.current.extra={label:'附加字段 😀',missing:undefined};
 const old=structuredClone(s),f={flows:[]},rt=P.create(s,f,420,false),expected=OldP.create(old,f,420,false);P.nativeViews(rt);OldP.nativeViews(expected);
 try{
  for(let i=0;i<95;i++){
   await M.advanceBudgetAsync(s,rt,500,options);await OldM.advanceBudgetAsync(old,expected,500,options);
   assert.deepEqual(s,old,`complete world ${i}`);
   const native=await P.historyAsync(rt,false);assert.deepEqual(native,{current:s.ridership.current,history:s.ridership.history},`native authority ${i}`);
   assert.deepEqual(await P.snapshotAsync(rt),await OldP.snapshotAsync(expected));assert.deepEqual(s,old,`saved world ${i}`);
  }
  assert.equal(s.ridership.history.length,30);
  assert.deepEqual(s.ridership.history.at(-1),old.ridership.history.at(-1));
  console.log('MAP57 lifecycle: 95 complete worlds, native current/history snapshots and runtime saves across 32 days; 30-day retention, empty observations, unknown fields and Unicode preserved.');
 }finally{P.dispose(rt);OldP.dispose(expected);}
})().catch(e=>{console.error(e);process.exitCode=1;});
