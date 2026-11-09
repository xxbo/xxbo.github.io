/* One consolidated acceptance suite for the complete P2-1 editor. */
const assert = require('node:assert/strict');
const N = require('../rail/network'),
  Old = require('./fixtures/rail-map61-network.cjs'),
  X = require('../rail/service-plan'),
  OX = require('./fixtures/rail-map61-service-plan.cjs'),
  R = require('../rail/engine'),
  OR = require('./fixtures/rail-map61-engine.cjs'),
  Core = require('../rail/routing-wasm');
const copy = v => structuredClone(v);
let checks = 0;

function seeded(fn) {
  const random = Math.random;
  Math.random = () => .31415926535;
  try {
    return fn();
  } finally {
    Math.random = random;
  }
}

function call(api, s, method, args) {
  try {
    return {
      value: seeded(() => api[method](s, ...args))
    };
  } catch (e) {
    return {
      thrown: e.message
    };
  }
}

function compare(base, method, args = []) {
  const a = copy(base),
    b = copy(base),
    old = call(Old, a, method, copy(args)),
    next = call(N, b, method, copy(args));
  assert.deepEqual(next, old, method + ' result #' + checks);
  assert.deepEqual(b, a, method + ' state #' + checks);
  assert.equal(JSON.stringify(b), JSON.stringify(a), method + ' field order #' + checks);
  checks++;
  return b;
}

function empty(region = 'gba') {
  return seeded(() => Old.emptyWorld(region));
}
const pts = (y = 500) => [{
  x: 600,
  y,
  nameSeed: .1
}, {
  x: 640,
  y,
  nameSeed: .2
}, {
  x: 680,
  y,
  nameSeed: .3
}, {
  x: 720,
  y,
  nameSeed: .4
}];
for (const region of ['tokyo', 'gba']) {
  assert.deepEqual(N.emptyWorld(region), Old.emptyWorld(region));
  let s = empty(region);
  s = compare(s, 'addLine', [pts(), null]);
  s = compare(s, 'addLine', [
    [s.services[0].stops[2], {
      x: 680,
      y: 550,
      nameSeed: .2
    }, {
      x: 680,
      y: 600,
      nameSeed: .4
    }], null
  ]);
  const id = s.services[0].id;
  s = compare(s, 'configure', [id, {
    name: '统一验收线',
    color: '#abcdef',
    fareBands: [180, 210, 260, 300, 330, 400]
  }]);
  s = compare(s, 'renameStation', [s.services[0].stops[0], '  统一站  ']);
  s = compare(s, 'addStation', [id, {
    x: 620,
    y: 510,
    nameSeed: .7
  }, {
    index: 1,
    bends: [{
      x: 610,
      y: 505
    }]
  }]);
  s = compare(s, 'removeStation', [id, s.services[0].stops[1]]);
  for (const point of [{
      x: 580,
      y: 500,
      nameSeed: .3
    }, {
      x: 740,
      y: 500,
      nameSeed: .6
    }, {
      x: 650,
      y: 505,
      nameSeed: .9
    }]) s = compare(s, 'addStation', [id, point]);
  s = compare(s, 'configure', [id, {
    patterns: [{
      kind: 'local',
      from: 0,
      to: s.services[0].stops.length - 1,
      fleet: 6,
      headway: 8
    }, {
      kind: 'short',
      from: 1,
      to: 3,
      fleet: 4,
      headway: 8
    }]
  }]);
  compare(s, 'removeStation', [id, s.services[0].stops[1]]);
  s = compare(s, 'configure', [id, {
    patterns: undefined
  }]);
  s = compare(s, 'removeLine', [s.services[1].id]);
  compare(s, 'removeLine', ['missing']);
  compare(s, 'configure', ['missing', {}]);
  compare(s, 'renameStation', [0, '']);
  compare(s, 'addLine', [
    [{
      waypoint: true,
      x: 30,
      y: 30
    }, ...pts()], null
  ]);
  compare(s, 'addLine', [
    [{
      x: 24,
      y: 40
    }, {
      x: 100,
      y: 100
    }], null
  ]);
  compare(s, 'addStation', [id, s.services[0].stops[0], {}]);
  compare(s, 'addStation', [id, {
    x: 600,
    y: 600
  }, {
    index: -1
  }]);
  compare(s, 'configure', [id, {
    color: 'bad'
  }]);
  compare(s, 'configure', [id, {
    name: ''
  }]);
  const restored = N.restore(s);
  assert(!restored.error);
  assert.deepEqual(restored.state, JSON.parse(JSON.stringify(s)));
  const broken = copy(s);
  broken.tracks[0].km += 10;
  assert(N.restore(broken).error);
  assert.deepEqual(s, restored.state);
  // Closed lines, directional loops and removal at the loop origin.
  let loop = empty(region);
  loop = compare(loop, 'addLine', [
    [{
      x: 800,
      y: 600,
      nameSeed: .1
    }, {
      x: 850,
      y: 650,
      nameSeed: .2
    }, {
      x: 800,
      y: 700,
      nameSeed: .3
    }, {
      x: 800,
      y: 600,
      nameSeed: .1
    }], null
  ]);
  loop = compare(loop, 'configure', [loop.services[0].id, {
    loopDirection: 'forward'
  }]);
  compare(loop, 'removeStation', [loop.services[0].id, loop.services[0].stops[0]]);
} {
  let s = empty();
  s = compare(s, 'addLine', [pts(), {
    stockSpec: '6B'
  }]);
  s = compare(s, 'upgrade');
  s.depot.stock['6B'] = 24;
  const id = s.services[0].id;
  s = compare(s, 'configure', [id, {
    dispatch: {
      mode: 'auto',
      manual: 8,
      offPeak: 4,
      peak: 8
    }
  }]);
  compare(s, 'configure', [id, {
    cars: 8
  }]);
  compare(s, 'configure', [id, {
    fleet: 8
  }]);
  compare(s, 'configure', [id, {
    dispatch: {
      mode: 'auto',
      manual: 8,
      offPeak: 12,
      peak: 8
    }
  }]);
  s = compare(s, 'configure', [id, {
    patterns: [{
      kind: 'local',
      from: 0,
      to: 3,
      fleet: 2,
      headway: 8
    }, {
      kind: 'short',
      from: 1,
      to: 2,
      fleet: 2,
      headway: 8
    }]
  }]);
  s = compare(s, 'addStation', [id, {
    x: 620,
    y: 510,
    nameSeed: .6
  }, {
    index: 1
  }]);
  compare(s, 'removeStation', [id, s.services[0].stops[2]]);
} {
  let s = empty();
  s = compare(s, 'addLine', [pts(), null]);
  s = compare(s, 'addLine', [
    [s.services[0].stops[3], {
      x: 760,
      y: 500,
      nameSeed: .2
    }, {
      x: 800,
      y: 500,
      nameSeed: .3
    }], null
  ]);
  const id = s.services[0].id,
    target = s.services[1].id;
  s = compare(s, 'configure', [id, {
    patterns: [{
      kind: 'cross',
      from: 0,
      to: 3,
      target,
      targetEnd: 2,
      fleet: 8,
      headway: 8
    }]
  }]);
  compare(s, 'removeLine', [target]);
  compare(s, 'removeStation', [target, s.services[1].stops[2]]);
  s = compare(s, 'addStation', [target, {
    x: 740,
    y: 510,
    nameSeed: .3
  }, {
    index: 1
  }]);
  assert.equal(s.services[0].patterns[0].targetEnd, 3);
} {
  let s = empty();
  s = compare(s, 'addLine', [pts(), null]);
  s = compare(s, 'addLine', [pts(550), null]);
  const b = s.services[1].stops[0];
  s.nodes[b].x = s.nodes[0].x + .5;
  s.nodes[b].y = s.nodes[0].y;
  for (const t of s.tracks) delete t.curve;
  for (const l of s.services) OX.geometry(s, l);
  compare(s, 'mergeNearby');
}
for (const s of [OR.newGame(), Old.tokyo(), empty()]) {
  compare(s, 'defaults');
  compare(s, 'upgrade');
  compare(s, 'removePreset');
  assert.equal(N.validate(s), Old.validate(s));
}
// Randomized successful/failing edits retain the full frozen result and ordering.
let state = empty();
state = compare(state, 'addLine', [pts(), null]);
for (let i = 0; i < 70; i++) {
  const l = state.services[0],
    method = i % 3 === 0 ? 'addStation' : i % 3 === 1 ? 'removeStation' : 'configure';
  const args = method === 'addStation' ? [l.id, {
    x: 800 + i * 3,
    y: 600 + (i % 7) * 5,
    nameSeed: i / 71
  }, {
    index: l.stops.length
  }] : method === 'removeStation' ? [l.id, l.stops[Math.min(2, l.stops.length - 1)]] : [l.id, {
    color: i % 2 ? '#ABCDEF' : '#123456',
    open: 360 + i,
    close: 1380
  }];
  state = compare(state, method, args);
}
// Structural world and network validation, including every top-level rule family.
const base = seeded(() => Old.tokyo());
const corrupt = [s => s.version = 3, s => s.quarter = -1, s => s.region = 'bad', s => s.world.width++, s => s
  .nodes[0].id = 7, s => s.nodes[0].people = -1, s => s.nodes[0].name = 'x'.repeat(41), s => s.nodes[0].x =
  Infinity, s => s.nodes[0].type = 'bad', s => s.tracks[0].km += 1, s => s.tracks[0].id = 'bad', s => s
  .tracks[0].a = 9999, s => s.tracks.push(copy(s.tracks[0])), s => s.services[0].headway = 3, s => s
  .services[0].trackIds = [], s => s.services[0].through = 1, s => s.services[0].operators = ['bad'], s => s
  .services[0].fleet = 3, s => s.services[0].color = 'bad', s => s.companies[0].fare = 0, s => s.companies[
    0].name = 'bad', s => s.companies[0].ledger = [{
    q: 0
  }], s => s.log = [{
    q: -1,
    text: 'bad'
  }], s => s.nextId = 1
];
for (const edit of corrupt) {
  const s = copy(base);
  edit(s);
  assert.equal(R.validate(s), OR.validate(s));
  assert.equal(N.validate(s), Old.validate(s));
  checks++;
}
// Geometry and graph parity against the frozen JS calculations.
for (let i = 0; i < 120; i++) {
  const points = Array.from({
      length: 2 + i % 5
    }, (_, j) => ({
      x: 100 + j * 18,
      y: 100 + Math.sin(i + j) * 30,
      name: 'p' + j,
      id: j
    })),
    before = i % 2 ? {
      x: 50,
      y: 90
    } : null,
    after = i % 3 ? {
      x: 260,
      y: 140
    } : null;
  for (const version of [11, 12]) assert.deepEqual(X.smooth(points, before, after, version), OX.smooth(points,
    before, after, version));
  for (const progress of [0, .17, .51, 1]) assert.deepEqual(X.along(points, progress), OX.along(points,
    progress));
  assert.equal(X.sum(points), OX.sum(points));
  checks++;
}
for (const s of [Old.upgrade(copy(base)), state]) {
  assert.deepEqual(X.network(s), OX.network(s));
  for (const l of X.expand(s).services) {
    assert.equal(X.headway(s, l), OX.headway(s, l));
    assert.equal(X.duration(s, l), OX.duration(s, l));
    assert.equal(X.loopDwell(s, l), OX.loopDwell(s, l));
  }
  checks++;
}
const Names = require('../rail/place-names'),
  OldNames = require('./fixtures/rail-map61-place-names.cjs');
for (const region of ['tokyo', 'gba']) {
  const s = seeded(() => Old.emptyWorld(region));
  seeded(() => Old.addLine(s, pts(), null));
  for (let i = 0; i < 40; i++) {
    const p = {
      x: 500 + i * 13,
      y: 500 + i * 9
    };
    assert.deepEqual(Names.suggest(s, p, i / 41), OldNames.suggest(s, p, i / 41));
    checks++;
  }
  const a = copy(s),
    b = copy(s);
  a.nodes[0].name = b.nodes[0].name = '新站 1';
  delete a.nodes[0].nameSource;
  delete b.nodes[0].nameSource;
  const ref = a.nodes[0];
  Names.migrate(a);
  OldNames.migrate(b);
  assert.deepEqual(a, b);
  assert.equal(a.nodes[0], ref);
} {
  const s = N.emptyWorld('gba'),
    before = Core.status();
  assert(!N.addLine(s, pts(), null).error);
  const after = Core.status();
  assert.equal(after.editorCalls - before.editorCalls, 1);
  assert.equal(after.geometryCalls, before.geometryCalls);
  assert.equal(after.serviceCalls, before.serviceCalls);
  Core.recycleSimulation();
  compare(s, 'addStation', [s.services[0].id, {
    x: 620,
    y: 510,
    nameSeed: .2
  }, {
    index: 1
  }]);
}
assert(Core.status().editorCalls > 0);
assert(Core.status().geometryCalls > 0);
console.log(
  `MAP62 P2-1: ${checks} complete frozen editor/world comparisons plus smooth/along/graph checks; add/remove/insert/merge, loops/cross remapping, managed dispatch, geometry, schema guards, rollback and validated undo passed.`
  );
