/* Frozen MAP43 continuous simulation oracle. Every tick and accounting field must agree. */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const P = require('../rail/passengers'),
  Old = require('./fixtures/rail-map43-passengers.cjs');
const Sim = require('../rail/simulation-wasm'),
  Core = require('../rail/routing-wasm');
const D = require('../rail/demand-model'),
  N = require('../rail/network'),
  F = require('../rail/fleet'),
  M = require('../rail/management');
const {
  create
} = require('./fixtures/rail-memory-grid.cjs');
const fields = ['people', 'jobs', 'shops', 'industry', 'leisure'];

function city(s) {
  const cells = s.nodes.map((n, i) => ({
    id: 'c' + i,
    x: n.x,
    y: n.y,
    w: 8,
    h: 8,
    area: .13,
    people: 8000 + i * 200,
    jobs: 4000 + i * 200,
    shops: 2000,
    industry: 50,
    leisure: 1000
  }));
  return {
    cells,
    totals: Object.fromEntries(fields.map(k => [k, cells.reduce((v, c) => v + c[k], 0)])),
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  };
}
let ticks = 0,
  samples = 0;

function pair(s, start = 480) {
  const a = structuredClone(s),
    b = structuredClone(s),
    forecast = D.evaluate(s, city(s));
  return {
    a,
    b,
    forecast,
    ra: P.create(a, forecast, start, false),
    rb: Old.create(b, forecast, start, false)
  };
}

function check(p, minutes) {
  P.advance(p.ra, p.a, minutes);
  Old.advance(p.rb, p.b, minutes);
  assert.deepEqual(P.snapshot(p.ra), Old.snapshot(p.rb));
  assert.deepEqual(p.ra.defs, p.rb.defs);
  assert.deepEqual(p.a, p.b);
  assert.deepEqual(P.summary(p.ra), Old.summary(p.rb));
  ticks++;
}
const p = pair(create(3));
for (let i = 0; i < 450; i++) check(p, i % 7 === 0 ? .03 : .1);
for (const start of [359.9, 419.9, 539.9, 959.9, 1139.9, 1379.9, 1439.9]) {
  const q = pair(create(2), start);
  for (let i = 0; i < 30; i++) check(q, .1);
}
// Crossings, short turns, express/direct trains and loop retirement.
const ring = M.init(N.upgrade(N.emptyWorld('gba')));
assert(!N.addLine(ring, [{
  x: 600,
  y: 500
}, {
  x: 650,
  y: 500
}, {
  x: 650,
  y: 550
}, {
  x: 600,
  y: 550
}, {
  x: 600,
  y: 500
}], {
  stockSpec: '6B'
}).error);
F.purchase(ring, '6B', 16);
N.configure(ring, ring.services[0].id, {
  dispatch: {
    mode: 'auto',
    manual: 8,
    offPeak: 2,
    peak: 8
  }
});
const rp = pair(ring, 535);
for (let i = 0; i < 100; i++) check(rp, .2);
const fast = create(3);
for (const l of fast.services) l.patterns = [{
  kind: 'local',
  from: 0,
  to: l.stops.length - 1,
  fleet: 4
}, {
  kind: 'direct',
  from: 0,
  to: l.stops.length - 1,
  fleet: 4
}];
const fp = pair(fast);
for (let i = 0; i < 200; i++) check(fp, .1);
// Continuous reconcile after route extension, dispatch changes and fare edits.
for (const state of [p]) {
  const id = state.a.services[0].id;
  for (const s of [state.a, state.b]) N.configure(s, id, {
    dispatch: {
      mode: 'manual',
      manual: 2,
      peak: 2,
      offPeak: 2
    },
    fareBands: [400, 500, 600, 700, 800, 900]
  });
  P.rebase(state.ra, state.a, D.evaluate(state.a, city(state.a)));
  Old.rebase(state.rb, state.b, D.evaluate(state.b, city(state.b)));
  for (let i = 0; i < 50; i++) check(state, .1);
}
// Independent exact sampling oracle including empty catalog, tiny OD, mutable coefficients and RNG wrap.
function sample(catalog, factor, profile, remainder, rng) {
  const weights = catalog.map(j => j.daily * factor(j) * profile(j));
  let total = 0;
  for (const w of weights) total += w;
  const accrued = remainder + total,
    count = Math.floor(accrued + 1e-9),
    rest = Math.max(0, accrued - count),
    events = [];
  if (!count || total <= 0) return {
    total,
    remainder: rest,
    rng,
    events: new Float64Array(events)
  };
  rng = (Math.imul(1664525, rng || 2463534242) + 1013904223) >>> 0;
  const step = total / count;
  let target = rng / 4294967296 * step,
    cumulative = 0,
    left = count;
  for (let i = 0; i < weights.length && left; i++) {
    cumulative += weights[i];
    let n = 0;
    while (left && target < cumulative) {
      n++;
      left--;
      target += step;
    }
    if (n) events.push(i, n);
  }
  if (left) {
    let i = weights.length - 1;
    while (i >= 0 && !weights[i]) i--;
    if (i >= 0) events.push(i, left);
  }
  return {
    total,
    remainder: rest,
    rng,
    events: new Float64Array(events)
  };
}
for (let i = 0; i < 300; i++) {
  const catalog = Array.from({
    length: i % 73
  }, (_, j) => ({
    daily: j % 5 === 0 ? 0 : (j + 1) * (i % 3 ? .001 : 30),
    lineIds: ['s' + j % 3],
    purpose: j % 2 ? 'work' : 'leisure',
    back: j % 2 === 0,
    externalKind: null,
    hub: null
  }));
  const factor = j => .3 + Number(j.lineIds[0].slice(1)) * .1,
    profile = j => j.purpose === 'work' ? .03 : .02;
  for (const rng of [0, 1, 0xffffffff]) {
    assert.deepEqual(Sim.arrivals(catalog, factor, profile, .7, rng), sample(catalog, factor,
      profile, .7, rng));
    samples++;
  }
  if (catalog.length) {
    catalog[0].daily = 123;
    assert.deepEqual(Sim.arrivals(catalog, factor, profile, .1, 42), sample(catalog, factor,
      profile, .1, 42));
    samples++;
  }
}
// Two native runtimes alternate in one instance; no runtime may use another's cached state.
const ia = pair(create(2)),
  ib = pair(create(2), 600);
for (let i = 0; i < 20; i++) {
  check(ia, .1);
  check(ib, .1);
}
// Many tiny OD groups retain the global expected total; none is individually rounded away.
const large = Array.from({
  length: 151056
}, (_, i) => ({
  daily: (i % 11 + 1) * .0005,
  lineIds: ['s0'],
  purpose: 'work',
  back: false,
  hub: null,
  externalKind: null
}));
assert.deepEqual(Sim.arrivals(large, () => .8, () => .1, .4, 0xffffffff), sample(large, () => .8,
() => .1, .4, 0xffffffff));
samples++;
// Public checkpoints restore while in motion; all passenger conservation terms survive.
const checkpoint = pair(create(2));
check(checkpoint, 10);
const saved = JSON.parse(JSON.stringify(P.snapshot(checkpoint.ra))),
  restored = P.restore(checkpoint.a, checkpoint.forecast, saved);
assert(restored);
assert.deepEqual(P.summary(restored), P.summary(checkpoint.ra));
const bytes = fs.readFileSync(path.join(__dirname, '../rail/wasm/rail-core-v12.wasm'));
Core.create(bytes, {
  recycleBytes: 0
});
const recycled = pair(create(2));
for (let i = 0; i < 30; i++) check(recycled, .1);
assert.throws(() => Core.kernel('simulation_run', [0]), /Rust\/WASM/);
check(recycled, .1);
Core.create(bytes, {
  recycleBytes: 64 * 1024 * 1024
});
assert.equal(Core.status().simulationAbi, 1);
const source = fs.readFileSync(path.join(__dirname, '../rail/passengers.js'), 'utf8');
assert(!source.includes('target < cumulative'));
assert(!source.includes('count < l.fleet'));
assert(!source.includes('(rt.minute - t.departedAt) /'));
console.log(
  `MAP44 passed: ${ticks} exact continuous checkpoints, ${samples} sampling comparisons, loop/express dispatch, signal/boarding, metrics, rebase, restore, owned batches and trap recovery.`
);
