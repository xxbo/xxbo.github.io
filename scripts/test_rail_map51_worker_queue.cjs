/* Frozen MAP44 oracle for native queue ownership and ordered event continuation. */
const assert = require('node:assert/strict'),
  fs = require('node:fs');
const P = require('../rail/passengers'),
  Old = require('./fixtures/rail-map50-passengers.cjs');
const M = require('../rail/management'),
  OldM = require('./fixtures/rail-map50-management.cjs');
const N = require('../rail/network'),
  D = require('../rail/demand-model'),
  Core = require('../rail/routing-wasm');
const {
  create
} = require('./fixtures/rail-memory-grid.cjs');
let checkpoints = 0,
  resumes = 0;
const runtimes=[];
const kernel = Core.kernel;
Core.kernel = function(name, input, ...rest) {
  if (name === 'engine_step' && input[4] === 1) resumes++;
  return kernel(name, input, ...rest);
};

function forecast(s) {
  const cells = s.nodes.map((n, i) => ({
    id: 'c' + i,
    x: n.x,
    y: n.y,
    w: 8,
    h: 8,
    area: .13,
    people: 300000,
    jobs: 200000,
    shops: 100000,
    industry: 500,
    leisure: 10000
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

function pair(weighted = false) {
  const a = create(3),
    b = structuredClone(a),
    f = forecast(a);
  const ra = P.create(a, f, 480, false),
    rb = Old.create(b, f, 480, false);
  if (weighted) ra.arrivalMode = rb.arrivalMode = 'weighted';
  for (const rt of [ra, rb])
    for (const k of Object.keys(rt.stationLimits)) rt.stationLimits[k] = {
      capacity: 20,
      outsideCapacity: 15
    };
  return {
    a,
    b,
    f,
    ra,
    rb
  };
}

async function step(p,dt) {
  const actual=await M.advanceBudgetAsync(p.a,p.ra,dt,{budget:1e6,maxSteps:10000,now:()=>0});
  const expected=OldM.advanceBudget(p.b,p.rb,dt,{budget:1e6,maxSteps:10000,now:()=>0});
  assert.deepEqual(actual,expected);
  assert.deepEqual(p.a,p.b);
  assert.equal(JSON.stringify(p.a),JSON.stringify(p.b));
  assert.equal(JSON.stringify(P.snapshot(p.ra)),JSON.stringify(Old.snapshot(p.rb)));
  assert.deepEqual(p.ra.defs,p.rb.defs);checkpoints++;
}
(async()=>{
for (const weighted of [false, true]) {
  const p = pair(weighted);runtimes.push(p.ra);
  for (let i = 0; i < 90; i++) await step(p, .5);
  assert(p.ra.rejected > 0);
  assert(p.ra.completed > 0);
  // Editing a populated network retains incumbent fares and retires old train geometry.
  for (const s of [p.a, p.b]) {
    const l = s.services[0];
    assert(!N.removeStation(s, l.id, l.stops[1]).error);
  }
  P.reconcile(p.ra, p.a);
  Old.reconcile(p.rb, p.b);
  for (let i = 0; i < 50; i++) await step(p, .5);
  for (const s of [p.a, p.b]) assert(!N.removeLine(s, s.services[2].id).error);
  P.reconcile(p.ra, p.a);
  Old.reconcile(p.rb, p.b);
  for (let i = 0; i < 40; i++) await step(p, .5);
  // Full archive replacement triggers a native reload without resetting queues or counters.
  P.rebase(p.ra, p.a, forecast(p.a));
  Old.rebase(p.rb, p.b, forecast(p.b));
  for (let i = 0; i < 20; i++) await step(p, .5);
  P.dispose(p.ra);
}
console.log(`MAP51 worker queues: ${checkpoints} exact complete states; crowding, retiring trains, station/line removal, reroutes and archive rebase.`);
})().catch(error=>{console.error(error);for(const rt of runtimes)P.dispose(rt);process.exitCode=1;});
