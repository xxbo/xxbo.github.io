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
const OldP = require('./fixtures/rail-map46-passengers.cjs'),
  OldQ = require('./fixtures/rail-map46-ridership.cjs'),
  OldM = require('./fixtures/rail-map46-management.cjs');
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
assert.equal(Core.status().statisticsCalls, editsBefore + 2);
exact(P.snapshot(removed.ra), OldP.snapshot(removed.rb));
exact(removed.a, removed.b);
check(removed, 5);
const bytes = fs.readFileSync(path.join(__dirname, '../rail/wasm/rail-core-v23.wasm'));
Core.create(bytes, {
  recycleBytes: 0
});
const recovery = pair();
for (let i = 0; i < 12; i++) check(recovery, .2, true);
Core.create(bytes, {
  recycleBytes: 64 * 1024 * 1024
});

// Satisfaction: pure query, zero-duration refresh, disconnected/through lines, crowded trains and legacy decay.
for (const model of [undefined, 22]) {
  const p = pair();
  for (const s of [p.a, p.b]) {
    if (model === undefined) delete s.ridership.model;
    else s.ridership.model = model;
    s.urban = {
      facilities: [{
        kind: 'school',
        level: 1,
        x: s.nodes[0].x,
        y: s.nodes[0].y
      }, {
        kind: 'hospital',
        level: 2,
        x: s.nodes.at(-1).x,
        y: s.nodes.at(-1).y
      }]
    };
  }
  for (let i = 0; i < 10; i++) {
    check(p, .3);
    for (let j = 0; j < p.a.services.length; j++) exact(Q.feedback(p.a, p.ra, p.a.services[j]), OldQ
      .feedback(p.b, p.rb, p.b.services[j]));
    Q.updateSatisfaction(p.a, p.ra, i === 0 ? 0 : 5);
    OldQ.updateSatisfaction(p.b, p.rb, i === 0 ? 0 : 5);
    exact(p.a, p.b);
  }
}
// Finance boundaries: fractional due times, overdue bills, zero cash, arrears, multi-day loans and save restore.
for (const scenario of ['due', 'overdue', 'arrears', 'exhaust', 'all-paid', 'multi']) {
  const p = pair(1859.95);
  for (const s of [p.a, p.b]) {
    s.economy.minute = 1859.95;
    s.economy.loans = [{
      id: 1,
      initial: 1e8,
      principal: 1e8,
      interest: 111.5,
      installment: 1e8 / 30,
      nextDue: scenario === 'overdue' ? 420 : 1860
    }];
    if (scenario === 'all-paid') {
      s.economy.loans[0].principal = .0009;
      s.economy.cash = 0;
    }
    if (scenario === 'arrears') {
      s.economy.arrears = 1e7;
      s.economy.cash = 99;
      s.economy.blocked = true;
    }
    if (scenario === 'exhaust') s.economy.cash = .01;
    if (scenario === 'multi') s.economy.loans.push({
      id: 2,
      initial: 2e8,
      principal: 1e8,
      interest: 20,
      installment: 2e8 / 30,
      nextDue: 1860.035
    });
  }
  for (let i = 0; i < 12; i++) check(p, .1, true);
  assert.equal(M.settle(p.a), OldM.settle(p.b));
  exact(p.a, p.b);

}
for (const minutes of [0, 1e-10, 1e-9, 1.1e-9, .0999999999999, .1, .1000000000001, 1.234567]) check(
  pair(), minutes, true);

// Public credit actions use the same native debt rules as automatic repayment.
{
  const a = create(2),
    b = structuredClone(a);
  for (const amount of [NaN, Infinity, '100000000', [1e8], null, -1, 0, 99999999, 1e8, 2e8, 1e9, 1e9]) {
    exact(M.borrow(a, amount), OldM.borrow(b, amount));
    exact(a, b);
    assert.equal(M.available(a), OldM.available(b));
    exact(a, b);
  }
  for (const id of [999, 2, 1, 3]) {
    exact(M.repay(a, id), OldM.repay(b, id));
    exact(a, b);
  }
  for (const x of [a, b]) {
    x.economy.cash = 0;
    x.economy.arrears = 500;
  }
  exact(M.borrow(a, 1e8), OldM.borrow(b, 1e8));
  exact(a, b);
  exact(M.repay(a, a.economy.loans[0].id), OldM.repay(b, b.economy.loans[0].id));
  exact(a, b);
}
assert.equal(Core.status().operationsAbi, 1);
console.log(
  `MAP47 passed: ${direct} event comparisons, ${checks} complete checkpoints, pure feedback/smoothing/coverage, shared fractional clock, debt/credit/arrears/stop boundaries and forced module recovery.`
  );
