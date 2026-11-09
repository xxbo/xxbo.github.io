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


(async()=>{
 for(const weighted of [false,true])for(const start of [419.83,539.83,1139.83,1439.83,1859.85]) {
  const p=pair(start,weighted);
  for(const state of [p.a,p.b]) {
   state.economy.cash=5e10;state.economy.minute=start;
   state.economy.loans=[{id:1,initial:1e8,principal:1e8,interest:20,installment:1e8/30,nextDue:start+.135}];
   U.init(state);state.urban.lastMinute=Math.max(420,start-360+.2);RV.init(state,start);
  }
  try {
   for(let i=0;i<8;i++) {
    const minutes=i%2?2.37:1.3;
    const result=await M.advanceBudgetAsync(p.a,p.ra,minutes,{budget:1e6,maxSteps:10000,now:()=>0});
    let remaining=minutes;while(remaining>1e-8){const dt=Math.min(.1,remaining);OldM.advance(p.b,p.rb,dt);remaining-=dt;}
    exact(p.a,p.b);exact(P.snapshot(p.ra),OldP.snapshot(p.rb));exact(p.ra.defs,p.rb.defs);assert.equal(result.remaining,remaining);checks++;
    if(i===2||i===5) {
     for(const state of [p.a,p.b])for(const l of state.services)assert(!N.configure(state,l.id,{dispatch:{mode:'auto',manual:8,offPeak:i===2?0:4,peak:8}}).error);
     P.reconcile(p.ra,p.a);OldP.reconcile(p.rb,p.b);
    }
   }
  }finally{P.dispose(p.ra);}
 }
 console.log(`MAP53 worker: ${checks} frozen MAP52 complete checkpoints; transferable cycle/loop, loans, peak/day/city/review, edits and weighted/integer demand.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
