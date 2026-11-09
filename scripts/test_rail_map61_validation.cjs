/* Frozen MAP60 oracle: full configuration validation and atomic deletion. */
const assert = require('node:assert/strict');
const X = require('../rail/service-plan'),
  Old = require('./fixtures/rail-map60-service-plan.cjs');
const N = require('../rail/network'),
  OldN = require('./fixtures/rail-map60-network.cjs'),
  M = require('../rail/management');
const Core = require('../rail/routing-wasm');
const {
  world
} = require('./fixtures/rail-map61-validation-world.cjs');
let count = 0;
{
  const before=Core.status();assert(X.validate(world()));const after=Core.status();
  assert.equal(after.serviceCalls-before.serviceCalls,1);
  assert.equal(after.demandCalls,before.demandCalls);
}

function check(s) {
  const before = structuredClone(s),
    expected = Old.validate(s);
  assert.equal(X.validate(s), expected, 'case ' + count);
  assert.deepEqual(s, before);
  count++;
}
check(world());
const edits = [
  s => delete s.world, s => s.world = null, s => s.services = [], s => s.tracks = [], s => delete s
  .services[0].patterns, s => s.services[0].patterns = [],
  ...[null, 0, 'bad', {},
    [],
    [20, 20, 20, 20, 20, 20],
    [30, 20, 20, 20, 20, 20],
    ['20', 20, 20, 20, 20, 20], Array(6)
  ].map(v => s => s.services[0].fareBands = v),
  ...['both', 'forward', 'reverse', 'invalid', false, 1].map(v => s => s.services[0].loopDirection = v),
  ...[-1, 0, 1, 2, 19, 20, 1.5, '0', null, NaN, Infinity].flatMap(v => ['from', 'to', 'fleet', 'headway',
    'targetEnd'
  ].map(k => s => s.services[0].patterns[0][k] = v)),
  ...[null, undefined, [],
    [1, 5],
    ['1'],
    [999], Array(2)
  ].map(v => s => {
    s.services[0].patterns[0].kind = 'express';
    s.services[0].patterns[0].calls = v;
  }),
  ...[null, 0, 'bad', [], Array(1), Array(121), Array(121).fill({
      x: 30,
      y: 30
    }), [{
      x: 25,
      y: 25
    }],
    [{
      x: 24,
      y: 25
    }],
    [{
      x: 976,
      y: 25
    }],
    [{
      x: '30',
      y: 30
    }],
    [{
      x: NaN,
      y: 20
    }],
    [null]
  ].map(v => s => s.tracks[0].bends = v),
  ...[null, {}, {
    before: {
      x: 30,
      y: 30
    }
  }, {
    after: {
      x: Infinity,
      y: 0
    }
  }, {
    before: {
      x: '30',
      y: 30
    }
  }].map(v => s => s.tracks[0].curve = v),
  s => s.routeModel = 8, s => s.operatingPlan = true, s => s.services[0].fleetManaged = false,
  s => s.services[0].dispatch.peak = 0, s => s.services[0].dispatch.offPeak = 0, s => s.services[0].dispatch
  .mode = 'manual',
  s => s.services[0].trackIds[0] = 'missing', s => s.tracks.push({
    ...s.tracks[0],
    km: 100
  }),
  s => s.services[0].stops[19] = s.services[0].stops[0],
  s => {
    const p = s.services[0].patterns[0];
    p.kind = 'cross';
    p.target = 'l1';
    p.targetEnd = 19;
    s.services[1].stops[0] = 19;
  },
  s => {
    s.services[1].patterns = structuredClone(s.services[0].patterns);
    s.services[1].trackIds = [...s.services[0].trackIds];
    s.services[1].dispatch.peak = 80;
  }
];
for (const edit of edits) {
  const s = world();
  edit(s);
  check(s);
}
for (let i = 0; i < 240; i++) {
  const s = world(1 + i % 4, 1 + i % 5),
    l = s.services[0];
  l.fleetManaged = i % 3 !== 0;
  l.dispatch.peak = i % 41 * 2;
  l.dispatch.offPeak = i % 11 * 2;
  l.fleet = Math.max(l.dispatch.peak, l.dispatch.offPeak);
  for (const [j, p] of l.patterns.entries()) {
    p.kind = ['local', 'short', 'express', 'direct'][j % 4];
    if (j) {
      p.from = i % 8;
      p.to = 10 + i % 10;
    }
    p.fleet = 2 + 2 * (i % 6);
  }
  s.economy.minute = [419, 420, 539, 540, 1020, 1140][i % 6];
  check(s);
}
for (const managed of [false, true])
  for (const dir of ['both', 'forward', 'reverse'])
    for (const minute of [480, 600]) {
      const s = world(1, 1),
        l = s.services[0];
      l.stops[19] = 0;
      l.fleetManaged = managed;
      l.loopDirection = dir;
      s.economy.minute = minute;
      delete l.patterns;
      check(s);
      l.dispatchCompiled = true;
      s.operatingPlan = true;
      l.callStops = [0, 3, 6, 9, 12, 15, 0];
      check(s);
      l.fleet = NaN;
      l.trackIds[0] = 'missing';
      check(s);
    }
// Per-track capacity threshold is inclusive and shared tracks count a service once.
for (const fleet of [0, 2, 10, 20, 40, 60, 80])
  for (const km of [0, .1, .45, 2, 20]) {
    const s = world(2, 3);
    for (const l of s.services) {
      l.fleet = fleet;
      l.dispatch = {
        mode: 'manual',
        manual: fleet,
        offPeak: fleet,
        peak: fleet
      };
    }
    s.services[1].trackIds = [...s.services[0].trackIds];
    s.tracks.forEach(t => t.km = km);
    check(s);
  } {
    const s = M.init(N.upgrade(N.emptyWorld('gba')));
    const a = N.addLine(s, [{
      x: 600,
      y: 500
    }, {
      x: 650,
      y: 500
    }, {
      x: 700,
      y: 500
    }], {
      stockSpec: '6B'
    });
    assert(!a.error);
    const b = N.addLine(s, [{
      x: 600,
      y: 550
    }, {
      x: 650,
      y: 550
    }, {
      x: 700,
      y: 550
    }], {
      stockSpec: '6B'
    });
    assert(!b.error);
    for (const id of [a.id, b.id, 'missing']) {
      const c = structuredClone(s),
        d = structuredClone(s);
      assert.deepEqual(N.removeLine(c, id), OldN.removeLine(d, id));
      assert.deepEqual(c, d);
    }
    const c = structuredClone(s);
    c.services[1].patterns = [{
      kind: 'local',
      from: 0,
      to: 2,
      fleet: 2,
      headway: 8,
      target: a.id
    }];
    const before = structuredClone(c);
    assert.deepEqual(N.removeLine(c, a.id), OldN.removeLine(structuredClone(c), a.id));
    assert.deepEqual(c, before);
    const invalid = structuredClone(s);
    invalid.nodes[0].x = NaN;
    const snapshot = structuredClone(invalid);
    assert(N.removeLine(invalid, a.id).error);
    assert.deepEqual(invalid, snapshot);
  }
console.log(
  `MAP61: ${count} frozen full-plan validations; geometry, fares, pattern types, peak capacity, legacy/compiled plans, immutable queries and atomic deletion passed.`
  );
