/* Exact MAP45 oracle: native operating statistics with sparse projections and external updates. */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const P = require('../rail/passengers'),
  Q = require('../rail/ridership'),
  M = require('../rail/management'),
  N = require('../rail/network'),
  D = require('../rail/demand-model'),
  X = require('../rail/service-plan'),
  Core = require('../rail/routing-wasm');
const OldP = require('./fixtures/rail-map45-passengers.cjs'),
  OldQ = require('./fixtures/rail-map45-ridership.cjs'),
  OldM = require('./fixtures/rail-map45-management.cjs');
const {
  create
} = require('./fixtures/rail-memory-grid.cjs');
let checks = 0,
  direct = 0;

function exact(a, b) {
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b),
    'serialized property order must remain stable');
}
// Standalone public statistics API remains Rust-backed, including unusual but supported event shapes.
{
  const a = create(2),
    b = structuredClone(a),
    ra = {
      minute: 420,
      plan: X.expand(a)
    },
    rb = {
      minute: 420,
      plan: X.expand(b)
    };
  const ids = a.services.map(l => l.id),
    trip = {
      lineIds: [ids[0], 'retired', ids[0]],
      fare: 123.4,
      byLine: {
        [ids[0]]: .37,
        [ids[1]]: .63
      }
    };
  for (const minute of [419.99999999, 420, 479.999, 480, 1379.9, 1859.99999999, 1860, 1921, 3300]) {
    ra.minute = rb.minute = minute;
    for (const kind of ['attempt', 'enter', 'board', 'alight', 'reject', 'complete', 'unknown'])
      for (const count of [.0001, 3, .2, -.01]) {
        Q.event(a, ra, trip, kind, count, 2.7, ids[0], 1);
        OldQ.event(b, rb, trip, kind, count, 2.7, ids[0], 1);
        exact(a.ridership, b.ridership);
        direct++;
      }
    const t = {
      service: ids[0],
      parentLine: ids[0],
      onboard: 3.2
    };
    Q.travel(a, ra, t, .003, {
      cars: 8
    });
    OldQ.travel(b, rb, t, .003, {
      cars: 8
    });
    exact(a.ridership, b.ridership);
    direct++;
  }
}

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

function check(p, dt, managed = false) {
  if (managed) {
    assert.equal(M.advance(p.a, p.ra, dt), OldM.advance(p.b, p.rb, dt));
  } else {
    P.advance(p.ra, p.a, dt);
    OldP.advance(p.rb, p.b, dt);
  }
  exact(P.snapshot(p.ra), OldP.snapshot(p.rb));
  exact(p.a, p.b);
  exact(p.ra.defs, p.rb.defs);
  checks++;
}
for (const weighted of [false, true]) {
  const p = pair(480, weighted);
  for (let i = 0; i < 100; i++) check(p, .2, i % 2 === 0);
  // External events and fare edits invalidate only the relevant native statistic inputs.
  for (const [s, rt, lib] of [
      [p.a, p.ra, Q],
      [p.b, p.rb, OldQ]
    ]) lib.event(s, rt, rt.defs[0], 'reject', .1);
  for (let i = 0; i < 30; i++) check(p, .2, true);
  for (const s of [p.a, p.b]) assert(!N.configure(s, s.services[0].id, {
    fareBands: [400, 500, 600, 700, 800, 900]
  }).error);
  P.reconcile(p.ra, p.a);
  OldP.reconcile(p.rb, p.b);
  P.rebase(p.ra, p.a, forecast(p.a));
  OldP.rebase(p.rb, p.b, forecast(p.b));
  for (let i = 0; i < 30; i++) check(p, .2, true);
  // Hour trimming, records and bucket transitions use the same operation order.
  check(p, 70, true);
}
for (const start of [419.9, 479.9, 1379.9, 1439.9, 1859.9]) {
  const p = pair(start);
  for (let i = 0; i < 12; i++) check(p, .1, true);
}
const batchOnly = pair();
const standalone = Core.status().statisticsCalls;
check(batchOnly, 60);
assert.equal(Core.status().statisticsCalls, standalone,
  'hot simulation must integrate statistics without a second WASM call');
// A busy line removal must use one statistics batch rather than one native call per rejected cohort.
const removed = pair(480, true);
check(removed, 4);
assert(P.summary(removed.ra).waiting > 0);
for (const s of [removed.a, removed.b])
  for (const l of [...s.services]) assert(!N.removeLine(s, l.id).error);
const editsBefore = Core.status().statisticsCalls;
P.reconcile(removed.ra, removed.a);
OldP.reconcile(removed.rb, removed.b);
assert.equal(Core.status().statisticsCalls, editsBefore + 1);
exact(P.snapshot(removed.ra), OldP.snapshot(removed.rb));
exact(removed.a, removed.b);
check(removed, 5);
const bytes = fs.readFileSync(path.join(__dirname, '../rail/wasm/rail-core-v10.wasm'));
Core.create(bytes, {
  recycleBytes: 0
});
const recovery = pair();
for (let i = 0; i < 12; i++) check(recovery, .2, true);
Core.create(bytes, {
  recycleBytes: 64 * 1024 * 1024
});
const source = fs.readFileSync(path.join(__dirname, '../rail/queue-runtime.js'), 'utf8');
assert(!source.includes('Q.event('));
assert(!source.includes('Q.travel('));
const qSource = fs.readFileSync(path.join(__dirname, '../rail/ridership.js'), 'utf8');
assert(!qSource.includes('d.attempted += count'));
assert(!qSource.includes('const revenue = count * (j.fare'));
assert.equal(Core.status().statisticsAbi, 1);
console.log(
  `MAP46 passed: ${direct} exact standalone event/travel comparisons and ${checks} complete MAP45 checkpoints; property order, fractional cohorts, hours/days/bins, finance interleaving, external edits, rebase and forced native recovery. Hot queue events make no per-event JS statistics calls.`
);
