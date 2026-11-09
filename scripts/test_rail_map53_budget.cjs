const assert=require('node:assert/strict');
const P=require('../rail/passengers'),M=require('../rail/management'),D=require('../rail/demand-model'),N=require('../rail/network');
const OldP=require('./fixtures/rail-map52-passengers.cjs'),OldM=require('./fixtures/rail-map52-management.cjs');
const Perf=require('../rail/performance'),OldPerf=require('./fixtures/rail-map52-performance.cjs');
const U=require('../rail/urban-growth'),RV=require('../rail/operations-review'),Core=require('../rail/routing-wasm');
const {create}=require('./fixtures/rail-memory-grid.cjs');
const exact=(a,b)=>{assert.deepEqual(a,b);assert.equal(JSON.stringify(a),JSON.stringify(b));};
let checks=0;
function forecast(s) {
  const cells = s.nodes.map((n, i) => ({
    id: 'c' + i,
    x: n.x,
    y: n.y,
    w: 8,
    h: 8,
    area: .13,
    people: 18000 + i * 500,
    jobs: 12000 + i * 200,
    shops: 5000,
    industry: 500,
    leisure: 1000
  }));
  return D.evaluate(s, {
    cells,
    totals: Object.fromEntries(['people', 'jobs', 'shops', 'industry', 'leisure'].map(k => [k,
      cells.reduce((v, c) => v + c[k], 0)
    ])),
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  });
}

function pair(start = 480, weighted = false) {
  const a = create(3),
    b = structuredClone(a),
    f = forecast(a),
    ra = P.create(a, f, start, false),
    rb = OldP.create(b, f, start, false);
  if (weighted) ra.arrivalMode = rb.arrivalMode = 'weighted';
  return {
    a,
    b,
    f,
    ra,
    rb
  };
}


for(const weighted of [false,true]) for(const start of [539.83,1859.85]) for(const debt of [false,true]) {
 const p=pair(start,weighted),clock=Perf.createClock(),oldClock=OldPerf.createClock();
 for(const s of [p.a,p.b]) {
  s.economy.minute=start;
  if(debt) s.economy.loans=[{id:1,initial:1e8,principal:1e8,interest:20,installment:1e8/30,nextDue:start+.135}];
  U.init(s);s.urban.lastMinute=Math.max(420,start-360+.2);RV.init(s,start);
 }
 for(let i=0;i<24;i++) {
  if(i===6||i===12) {
   for(const s of [p.a,p.b]) for(const l of s.services) {
    const r=N.configure(s,l.id,{dispatch:{mode:'auto',manual:8,offPeak:i===6?0:4,peak:8}});assert(!r.error);
   }
   P.reconcile(p.ra,p.a);OldP.reconcile(p.rb,p.b);
  }
  const elapsed=[0,.016,.04,.12,.3,-.1,.001][i%7];
  const a=clock.runBudget(elapsed,24,5,(dt,options)=>M.advanceBudget(p.a,p.ra,dt,{...options,nativeLoop:true}),()=>0);
  const b=oldClock.run(elapsed,24,5,dt=>OldM.advance(p.b,p.rb,dt),()=>0);
  exact(a,b);exact(p.a,p.b);exact(P.snapshot(p.ra),OldP.snapshot(p.rb));checks++;
 }
}
// Yield by wall time, step count and cancellation; remaining requests resume without resets.
for(const mode of ['time','steps','interrupt']) {
 const p=pair();let ticks=0;
 const options=mode==='time'?{budget:2,now:()=>ticks++}:mode==='steps'?{budget:1e6,maxSteps:2,now:()=>0}:
  {budget:1e6,now:()=>0,shouldYield:()=>++ticks>2};
 const result=M.advanceBudget(p.a,p.ra,10,options);
 assert.equal(result.steps,2);assert.equal(result.reason,mode==='time'?'time':mode==='steps'?'steps':'interrupted');
 for(let i=0;i<2;i++) OldM.advance(p.b,p.rb,.1);
 exact(p.a,p.b);exact(P.snapshot(p.ra),OldP.snapshot(p.rb));
 const next=M.advanceBudget(p.a,p.ra,result.remaining,{budget:1e6,maxSteps:10000,now:()=>0,nativeLoop:true});
 let pending=result.remaining;while(pending>1e-8) {const dt=Math.min(.1,pending);OldM.advance(p.b,p.rb,dt);pending-=dt;}
 assert.equal(next.remaining,pending);exact(p.a,p.b);exact(P.snapshot(p.ra),OldP.snapshot(p.rb));checks+=2;
}
// A blocked account stops both clocks and clears accumulated presentation time identically.
{
 const p=pair();p.a.economy.cash=p.b.economy.cash=.01;
 const a=Perf.createClock().runBudget(.12,24,5,(dt,o)=>M.advanceBudget(p.a,p.ra,dt,o),()=>0);
 const b=OldPerf.createClock().run(.12,24,5,dt=>OldM.advance(p.b,p.rb,dt),()=>0);
 exact(a,b);exact(p.a,p.b);exact(P.snapshot(p.ra),OldP.snapshot(p.rb));checks++;
}
{
 const p=pair(),r=M.advanceBudget(p.a,p.ra,2000,{budget:1e6,maxSteps:1,now:()=>0});
 assert.equal(r.steps,1);assert.equal(r.remaining,1999.9);OldM.advance(p.b,p.rb,.1);
 exact(p.a,p.b);exact(P.snapshot(p.ra),OldP.snapshot(p.rb));checks++;
}
for(const bad of [-1,NaN,Infinity,1e8+1]) assert.throws(()=>M.advanceBudget(create(2),{},bad));
assert(Core.status().loopSteps>0,'Rust must execute actual multiple-step continuations');
console.log(`MAP53 budget: ${checks} complete frozen MAP52 clock/state checks; frame remainders, minute/peak/debt/day/city/review boundaries, edits, pause/step/cancel yields and cash-stop continuity.`);
