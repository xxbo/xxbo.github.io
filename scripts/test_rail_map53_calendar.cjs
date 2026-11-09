const assert=require('node:assert/strict'),P=require('../rail/passengers'),M=require('../rail/management'),N=require('../rail/network'),F=require('../rail/fleet'),C=require('../rail/city'),Q=require('../rail/ridership');
const OldP=require('./fixtures/rail-map52-passengers.cjs'),OldM=require('./fixtures/rail-map52-management.cjs');
const options={budget:1e6,maxSteps:10000,now:()=>0};
function scene(managed,direction) {
 const s=M.init(N.emptyWorld());
 const opts=managed?{stockSpec:'6B'}:null;
 let r=N.addLine(s,[{x:1168,y:920},{x:1195,y:920},{x:1195,y:948},{x:1168,y:948},{x:1168,y:920}],opts);assert(!r.error,r.error);
 r=N.addLine(s,[0,{x:1120,y:914},{x:1070,y:910},{x:1020,y:900}],opts);assert(!r.error,r.error);
 if(managed){assert(!F.purchase(s,'6B',40).error);}
 for(const l of s.services) {
  const values=managed?{dispatch:{mode:'auto',manual:8,offPeak:6,peak:8}}:{fleet:12};
  if(l===s.services[0])values.loopDirection=direction;
  else values.patterns=[{kind:'local',from:0,to:3,fleet:2,headway:20},{kind:'express',from:0,to:3,calls:[l.stops[0],l.stops[2],l.stops[3]],fleet:2,headway:20},{kind:'direct',from:0,to:3,fleet:2,headway:20}];
  const result=N.configure(s,l.id,values);assert(!result.error,JSON.stringify({managed,direction,values,error:result.error}));
 }
 Q.enableSatisfaction(s);return s;
}
(async()=>{
 let checks=0;
 for(const managed of [false,true])for(const direction of ['both','forward','reverse']) {
  const s=scene(managed,direction),old=structuredClone(s),f=C.evaluate(s),rt=P.create(s,f,539.8,false),expected=OldP.create(old,f,539.8,false);
  s.economy.minute=old.economy.minute=539.8;P.nativeViews(rt);
  // A repayment inside a quantum must preserve the old split, ledger and remainder.
  for(const x of [s,old])x.economy.loans=[{id:1,initial:1e8,principal:1e8,interest:20,installment:1e8/30,nextDue:540.035}];
  try {
   for(const dt of [1.2,7.3,16.4,25.7,12.1]) {
    const actual=await M.advanceBudgetAsync(s,rt,dt,options),before=OldM.advanceBudget(old,expected,dt,options);
    assert.deepEqual(actual,before);assert.deepEqual(s,old,`${managed}/${direction} world ${rt.minute}`);
    assert.deepEqual(await P.snapshotAsync(rt),OldP.snapshot(expected),`${managed}/${direction} runtime ${rt.minute}`);checks++;
   }
   // Mutating a view's progress must not become authoritative runtime input or saved state.
   const moving=rt.trains.find(t=>t.status==='moving');if(moving){moving.progress=.999999;assert.deepEqual(await P.snapshotAsync(rt),OldP.snapshot(expected));}
  }finally{P.dispose(rt);}
 }
 console.log('MAP53 calendar:',checks,'native-state checkpoints; managed/unmanaged, both/forward/reverse loops, local/express/direct, peak changes and sub-quantum repayment.');
})().catch(e=>{console.error(e);process.exitCode=1;});
