/* Frozen MAP44 oracle for native queue ownership and ordered event continuation. */
const assert = require('node:assert/strict'),
  fs = require('node:fs');
const P = require('../rail/passengers'),
  Old = require('./fixtures/rail-map44-passengers.cjs');
const N = require('../rail/network'),
  D = require('../rail/demand-model'),
  Core = require('../rail/routing-wasm');
const {
  create
} = require('./fixtures/rail-memory-grid.cjs');
let checkpoints = 0,
  resumes = 0;
const kernel = Core.kernel;
Core.kernel = function(name, input, ...rest) {
  if (name === 'simulation_step' && input[2] === 1) resumes++;
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

function step(p, dt) {
  P.advance(p.ra, p.a, dt);
  Old.advance(p.rb, p.b, dt);
  assert.deepEqual(P.snapshot(p.ra), Old.snapshot(p.rb));
  assert.deepEqual(p.ra.defs, p.rb.defs);
  assert.deepEqual(p.a, p.b);
  const v = P.summary(p.ra);
  assert(Math.abs(v.generated - v.completed - v.cancelled - v.waiting - v.onboard) < 1e-5);
  checkpoints++;
}
for (const weighted of [false, true]) {
  const p = pair(weighted);
  for (let i = 0; i < 90; i++) step(p, .5);
  assert(p.ra.rejected > 0);
  assert(p.ra.completed > 0);
  // Editing a populated network retains incumbent fares and retires old train geometry.
  for (const s of [p.a, p.b]) {
    const l = s.services[0];
    assert(!N.removeStation(s, l.id, l.stops[1]).error);
  }
  P.reconcile(p.ra, p.a);
  Old.reconcile(p.rb, p.b);
  for (let i = 0; i < 50; i++) step(p, .5);
  for (const s of [p.a, p.b]) assert(!N.removeLine(s, s.services[2].id).error);
  P.reconcile(p.ra, p.a);
  Old.reconcile(p.rb, p.b);
  for (let i = 0; i < 40; i++) step(p, .5);
  // Full archive replacement triggers a native reload without resetting queues or counters.
  P.rebase(p.ra, p.a, forecast(p.a));
  Old.rebase(p.rb, p.b, forecast(p.b));
  for (let i = 0; i < 20; i++) step(p, .5);
}
const bytes = fs.readFileSync(require('node:path').join(__dirname,
  '../rail/wasm/rail-core-v5.wasm'));
Core.create(bytes, {
  recycleBytes: 0
});
const recovery = pair();
for (let i = 0; i < 20; i++) step(recovery, .5);
for (const s of [recovery.a, recovery.b]) assert(!N.removeLine(s, s.services[0].id).error);
P.reconcile(recovery.ra, recovery.a);
Old.reconcile(recovery.rb, recovery.b);
for (let i = 0; i < 30; i++) step(recovery, .5);
Core.create(bytes, {
  recycleBytes: 64 * 1024 * 1024
});
assert.equal(Core.status().queueAbi, 1);
assert(resumes > 0, 'must exercise native reroute continuation');
const source = fs.readFileSync(require('node:path').join(__dirname, '../rail/passengers.js'),
  'utf8');
for (const name of ['function board(', 'function unload(', 'function gates(', 'function admit(',
    'function waitingTransfer('
  ]) assert(!source.includes(name), name + ' remains in production JS');
console.log(
  `MAP45 passed: ${checkpoints} exact frozen MAP44 checkpoints; bounded gates, rejection, integer/weighted cohorts, transfers, fare/accounting, ${resumes} reroute continuations, extension/deletion, full reload and forced native recycling.`
  );
