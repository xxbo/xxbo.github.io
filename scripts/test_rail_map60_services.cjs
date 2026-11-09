/* Frozen MAP59 oracle: topology, peak allocation, errors, and immutable inputs. */
const assert = require('node:assert/strict');
const old = require('./fixtures/rail-map59-service-plan.cjs');
const current = require('../rail/service-plan');
const core = require('../rail/routing-wasm');

function world(managed = true) {
  const make = (id, stops) => ({
    id,
    name: id,
    stops,
    trackIds: stops.slice(1).map((_, i) => id + i),
    fleet: 16,
    headway: 8,
    stockSpec: '6B',
    fleetManaged: managed,
    dispatch: {
      mode: 'auto',
      manual: 8,
      offPeak: 8,
      peak: 16
    },
    extra: {
      retained: true
    }
  });
  return {
    routeModel: 9,
    economy: {
      minute: 480
    },
    services: [make('a', [0, 1, 2, 3, 4]), make('b', [4, 5, 6, 7]), make('c', [8, 9, 10, 8])]
  };
}
let checks = 0;

function compare(s, minute = 480, p = null, index = 0) {
  const before = structuredClone(s);
  const call = api => {
    try {
      return {
        value: p ? api.compile(s, s.services[0], p, index, minute) : api.expand(s, minute)
      };
    } catch (e) {
      return {
        error: e.message
      };
    }
  };
  assert.deepEqual(call(current), call(old));
  assert.deepEqual(s, before);
  checks++;
}
for (const managed of [false, true])
  for (const minute of [-1, 0, 419, 420, 539, 540, 1019, 1020, 1139, 1140, 1860]) {
    const s = world(managed);
    compare(s, minute);
    s.services[0].patterns = ['local', 'short', 'express', 'direct', 'cross'].map((kind, i) => ({
      kind,
      from: i === 1 ? 3 : 0,
      to: i === 1 ? 1 : 4,
      calls: [1, 3],
      fleet: 2,
      headway: 8,
      target: 'b',
      targetEnd: 3
    }));
    compare(s, minute);
    for (let i = 0; i < 5; i++) compare(s, minute, s.services[0].patterns[i], i);
    s.services[0].dispatch.mode = 'manual';
    compare(s, minute);
    s.services[0].patterns = [];
    compare(s, minute);
  }
for (let seed = 1; seed <= 150; seed++) {
  const s = world(seed % 2 === 0),
    l = s.services[0];
  l.patterns = Array.from({
    length: 1 + seed % 8
  }, (_, i) => ({
    kind: ['short', 'express', 'direct'][i % 3],
    from: (seed + i) % 5,
    to: (seed + i + 2) % 5,
    calls: [seed % 5],
    fleet: 2 + 2 * (i % 4),
    headway: 8
  }));
  l.dispatch.peak = 2 * (seed % 41);
  l.dispatch.offPeak = 2 * (seed % 17);
  compare(s, seed * 43);
}
const cross = {
  kind: 'cross',
  from: 0,
  to: 4,
  fleet: 4,
  headway: 8,
  target: 'b',
  targetEnd: 3
};
for (const edit of [s => s.services.splice(1, 1), s => s.services[1].stops = [20, 21, 22, 23], s => s
    .services[1].stockSpec = '8A', s => s.services[1].id = 'a', s => s.services[1].stops = [4, 1, 6, 7],
    s => s.services[0].stops = [0, 1, 2, 1, 4]
  ]) {
  const s = world();
  edit(s);
  compare(s, 480, cross);
} {
  const s = world();
  compare(s, 480, {
    ...cross,
    target: 'a',
    targetEnd: 0
  });
  s.services[0] = s.services[2];
  compare(s, 480, {
    kind: 'direct',
    from: 0,
    to: 3,
    fleet: 2,
    headway: 8
  });
}
for (const fleet of [undefined, null, 0, NaN]) {
  const s = world(false);
  s.services[0].fleet = fleet;
  compare(s);
} {
  const s = world();
  s.routeModel = 8;
  assert.equal(current.expand(s), s);
  s.routeModel = 9;
  s.operatingPlan = true;
  assert.equal(current.expand(s), s);
} {
  const s = world(),
    l = s.services[0];
  l.patterns = [{
    kind: 'express',
    from: 0,
    to: 4,
    calls: [2],
    fleet: 4,
    headway: 8
  }];
  compare(s);
  const n = core.status().serviceCalls;
  compare(s, 481);
  assert.equal(core.status().serviceCalls, n);
  const out = current.expand(s);
  out.services[0].stops.push(99);
  out.services[0].trackIds[0] = 'bad';
  out.services[0].callStops.length = 0;
  compare(s);
  for (const edit of [() => l.patterns[0].calls.push(1), () => l.patterns[0].to = 3, () => l.dispatch.peak =
      12, () => l.stops[2] = 22, () => l.trackIds[0] = 'new', () => l.name = 'changed', () => l.patterns[0]
      .headway = 12
    ]) {
    edit();
    compare(s);
  }
  l.patterns[0] = {
    kind: 'cross',
    from: 0,
    to: 4,
    target: 'b',
    targetEnd: 3,
    fleet: 4,
    headway: 8
  };
  compare(s);
  s.services[1].stops[1] = 55;
  compare(s);
  s.services[1].stockSpec = '8A';
  compare(s);
  s.services[1].stockSpec = '6B';
  compare(s);
}
for (const index of [undefined, null, '1', '01', -1, 1.5]) {
  const s = world();
  compare(s, 480, {
    kind: 'local',
    from: 0,
    to: 4,
    fleet: 2,
    headway: 8
  }, index);
} {
  const s = world(),
    p = {
      kind: 'local',
      from: 0,
      to: 4,
      fleet: 2,
      headway: 8
    };
  assert.deepEqual(current.compile(s, s.services[0], p), old.compile(s, s.services[0], p));
}
assert(core.status().serviceCalls > 0);
console.log(
  `MAP60: ${checks} frozen service comparisons, peak boundaries, five patterns, cross/loop errors, fleet allocation and immutable inputs passed.`
);
