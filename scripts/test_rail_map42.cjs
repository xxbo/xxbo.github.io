/* Exact demand-kernel gate against frozen MAP41; no epsilon relaxations. */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const D = require('../rail/demand-model'),
  Old = require('./fixtures/rail-map41-demand.cjs');
const Router = require('../rail/routing-wasm'),
  KD = require('../rail/demand-kernels');
const N = require('../rail/network'),
  F = require('../rail/fleet'),
  P = require('../rail/passengers'),
  M = require('../rail/management'),
  LS = require('../rail/local-save');
const {
  create
} = require('./fixtures/rail-memory-grid.cjs');
let seed = 0x42c0ffee;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const clean = value => JSON.parse(JSON.stringify(value, (key, v) => ['memory', 'calculationMs'].includes(key) ? undefined : v));
let matrices = 0,
  modes = 0,
  strategies = 0,
  forecasts = 0;
for (let size = 0; size <= 14; size++)
  for (const limit of [0, 1, 3, 24, 64, 160]) {
    const values = Array.from({
        length: size * size
      }, (_, i) => i % 9 === 0 ? 0 : random() * 20),
      rows = Array.from({
        length: size
      }, () => random() * 100),
      cols = Array.from({
        length: size
      }, () => random() * 100);
    const original = [...values];
    assert.deepEqual(D.ipf(values, rows, cols, size, limit, 1e-6), Old.ipf(values, rows, cols, size, limit, 1e-6));
    assert.deepEqual(values, original);
    matrices++;
  }
for (let i = 0; i < 1200; i++) {
  const availability = i % 6 === 0 ? {
    walk: 0,
    bike: 0,
    car: 0,
    bus: 0,
    rail: 0
  } : i % 5 === 0 ? {
    walk: 0,
    bike: 0,
    car: 0,
    bus: 0,
    rail: 1
  } : i % 3 === 0 ? {
    rail: 0,
    bus: .2,
    car: .8
  } : {};
  const args = {
    purpose: ['work', 'shopping', 'leisure', 'unknown'][i % 4],
    minutes: random() * 250,
    access: random() * 80,
    fare: random() * 2200,
    km: random() * 90,
    availability
  };
  if (i % 2) args.accessCost = random() * 150;
  assert.equal(D.modeShare(args), Old.modeShare(args));
  modes++;
}
for (let i = 0; i < 200; i++) {
  const paths = Array.from({
    length: i % 13
  }, (_, j) => j % 7 === 0 ? null : ({
    minutes: Math.floor(random() * 100),
    fare: Math.floor(random() * 600),
    edges: j % 9 === 0 ? [] : [{
      service: 'p' + j % 4,
      dir: j % 2 ? -1 : 1,
      headway: 2 + j % 5
    }]
  }));
  for (const value of [null, 0, 20, 60]) {
    const before = JSON.stringify(paths);
    assert.deepEqual(D.strategy(paths, 'work', value), Old.strategy(paths, 'work', value));
    assert.equal(JSON.stringify(paths), before);
    strategies++;
  }
}

function cityFor(s, effective = true) {
  const cells = s.nodes.map((n, i) => ({
    id: 'z' + i,
    x: n.x,
    y: n.y,
    w: 8,
    h: 8,
    area: .13,
    people: 800 + i % 3 * 210,
    jobs: 400 + i % 4 * 180,
    shops: 120 + i % 5 * 80,
    industry: 40,
    leisure: 90
  }));
  const totals = Object.fromEntries(['people', 'jobs', 'shops', 'industry', 'leisure'].map(k => [k, cells.reduce((n, c) => n + c[k], 0)]));
  return {
    cells,
    totals,
    metadata: {
      effectiveConnections: effective,
      demandZoneUnits: 40
    }
  };
}
const state = create(5);
for (const effective of [false, true]) {
  const city = cityFor(state, effective);
  const source = JSON.stringify(city);
  assert.deepEqual(D.distribution(city), Old.distribution(city));
  matrices++;
  assert.strictEqual(D.distribution(city), D.distribution(city));
  const actual = D.evaluate(state, city),
    expected = Old.evaluate(state, city);
  assert.deepEqual(clean(actual), clean(expected));
  assert.equal(JSON.stringify(city), source);
  forecasts++;
  assert.equal(actual.diagnostics.memory.demand, 'rust-wasm-forecast-abi1');
}
// Zero population/zero attraction and disconnected network preserve empty demand semantics.
for (const kind of ['empty', 'no-people', 'no-jobs', 'disconnected', 'crowded']) {
  const s = create(3),
    city = cityFor(s);
  if (kind === 'empty') {
    city.cells = [];
    for (const k of Object.keys(city.totals)) city.totals[k] = 0;
  }
  if (kind === 'no-people') {
    for (const c of city.cells) c.people = 0;
    city.totals.people = 0;
  }
  if (kind === 'no-jobs') {
    for (const c of city.cells) {
      c.jobs = 0;
      c.shops = 0;
      c.leisure = 0;
    }
    city.totals.jobs = city.totals.shops = city.totals.leisure = 0;
  }
  if (kind === 'disconnected')
    for (const line of s.services) N.configure(s, line.id, {
      dispatch: {
        mode: 'manual',
        manual: 0,
        peak: 0,
        offPeak: 0
      }
    });
  if (kind === 'crowded') {
    for (const c of city.cells)
      for (const k of Object.keys(city.totals)) c[k] *= 100000;
    for (const k of Object.keys(city.totals)) city.totals[k] *= 100000;
  }
  const actual = D.evaluate(s, city);
  assert.deepEqual(clean(actual), clean(Old.evaluate(s, city)));
  forecasts++;
  if (kind === 'crowded') assert(actual.unserved > 0);
}
// Capacity assignment: repeated/shared tracks, zero service, over-capacity and first-seen key order.
for (let i = 0; i < 50; i++) {
  const s = create(2),
    a = {
      flows: Array.from({
        length: 8
      }, (_, j) => ({
        trips: j === 0 ? 0 : (i + 1) * 1000000 + j,
        demandTrips: j === 0 ? 0 : (i + 1) * 1000000 + j,
        path: {
          edges: [{
            tracks: [s.tracks[j % s.tracks.length].id],
            parts: [{
              line: s.services[j % s.services.length].id
            }]
          }]
        }
      })),
      trackFlow: {},
      trackLoad: {},
      serviceFlow: {},
      riders: 0,
      unserved: 0
    };
  const b = structuredClone(a),
    X = require('../rail/service-plan'),
    R = require('../rail/engine'),
    plan = X.expand(s);
  for (const f of b.flows)
    for (const e of f.path.edges)
      for (const id of e.tracks || [e.track]) b.trackFlow[id] = (b.trackFlow[id] || 0) + f.trips;
  for (const t of s.tracks) {
    const cap = plan.services.filter(l => l.trackIds.includes(t.id)).reduce((v, l) => v + 60 / X.headway(plan, l) * R.capacity(l), 0);
    b.trackLoad[t.id] = (b.trackFlow[t.id] || 0) * .18 / Math.max(1, cap);
  }
  for (const f of b.flows) {
    const ratio = Math.min(1, ...f.path.edges.flatMap(e => e.tracks || [e.track]).map(id => 1 / Math.max(1, b.trackLoad[id] || 0)));
    f.trips *= ratio;
    b.riders += f.trips;
    b.unserved += f.demandTrips - f.trips;
    for (const id of new Set(f.path.edges.flatMap(e => e.parts.map(p => p.line)))) b.serviceFlow[id] = (b.serviceFlow[id] || 0) + f.trips;
  }
  KD.capacity(s, a, plan, X, R);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
}
// Stateful continuity and export/restore at every rebase; the core is never saved as native memory.
const city = cityFor(state),
  f = D.evaluate(state, city),
  rt = P.create(state, f, 480, false);
state.economy.minute = 480;
for (let step = 0; step < 6; step++) {
  M.advance(state, rt, 20);
  const before = P.summary(rt);
  const next = D.evaluate(state, city);
  P.rebase(rt, state, next);
  assert.deepEqual(P.summary(rt), before);
  const sum = P.summary(rt);
  assert(Math.abs(sum.generated - sum.waiting - sum.onboard - sum.completed - sum.cancelled) < 1e-5);
  const save = LS.parse(JSON.stringify(LS.pack(state, P.snapshot(rt))));
  assert(P.restore(save.state, next, save.runtime));
}
const bytes = fs.readFileSync(path.join(__dirname, '../rail/wasm/rail-core-v21.wasm'));
Router.create(bytes, {
  recycleBytes: 0
});
const owned = D.ipf([1, 2, 3, 4], [30, 70], [40, 60], 2),
  copy = owned.matrix.slice();
for (let i = 0; i < 5; i++) D.modeShare({
  purpose: 'work',
  minutes: 10,
  access: 3,
  fare: 180,
  km: 8
});
assert.deepEqual(owned.matrix, copy);
assert.throws(() => Router.kernel('demand_ipf', [2, 160, 1e-6]), /Rust\/WASM/);
assert.deepEqual(D.ipf([1, 2, 3, 4], [30, 70], [40, 60], 2), Old.ipf([1, 2, 3, 4], [30, 70], [40, 60], 2));
Router.create(bytes, {
  recycleBytes: 64 * 1024 * 1024
});
assert.throws(() => D.ipf([1], [1], [1], 2), /尺寸/);
const source = fs.readFileSync(path.join(__dirname, '../rail/demand-model.js'), 'utf8');
assert(!/function (ipf|modeShare|strategy)\(/.test(source));
assert(!source.includes('fit.matrix'));
assert(!source.includes('f.trips *= ratio'));
console.log(`MAP42 passed: ${matrices} exact matrices, ${modes} mode choices, ${strategies} frequency strategies, ${forecasts} full-demand forecasts; capacity parity, conservation, save/restore, owned buffers and trap recovery.`);