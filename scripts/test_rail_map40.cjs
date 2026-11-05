/* Exact route parity, bounded cache/telemetry, lean demand transport and save backpressure. */
const assert = require('node:assert/strict');
const {
  fixture,
  N,
  M,
  Q,
  X
} = require('./fixtures/rail-ui-scenario.cjs');
const oldPaths = require('./fixtures/rail-map39-paths.cjs');
const Cache = require('../rail/bounded-cache'),
  Queue = require('../rail/save-queue'),
  Audit = require('../rail/memory-audit'),
  Snapshot = require('../rail/demand-snapshot');
const D = require('../rail/demand-model'),
  P = require('../rail/passengers'),
  DB = require('../rail/save-store'),
  LS = require('../rail/local-save');
const {
  s
} = fixture(), graph = X.network(s), before = JSON.stringify(s);
for (const from of s.nodes.map(n => n.id))
  for (const value of [.025, .045, .05])
    for (const first of [null, ...new Set(graph[from].slice(0, 2).map(e => e.service + '|' + e.dir))]) {
      const expected = oldPaths(s, graph, from, value, first),
        actual = X.paths(s, graph, from, value, first),
        compact = X.compactPaths(s, graph, from, value, first);
      assert.deepEqual(actual, expected);
      assert.deepEqual(compact.map((_, id) => X.pathAt(compact, id)), expected);
      assert(compact.every(index => Number.isInteger(index)));
      assert(compact.routingData.data instanceof Float64Array);
      assert(compact.memoryWeight >= compact.filter(Boolean).length);
    }
assert.equal(JSON.stringify(s), before);
const cache = Cache.create({
  limit: 2,
  maxWeight: 5,
  weight: x => x
});
cache.set('a', 2);
cache.set('b', 2);
cache.get('a');
cache.set('c', 2);
assert.equal(cache.get('b'), undefined);
assert.equal(cache.get('a'), 2);
cache.set('huge', 9);
assert.equal(cache.get('huge'), undefined);
assert(cache.stats().peakWeight <= 5);
assert(cache.stats().peak <= 2);
assert.equal(cache.stats().oversized, 1);
cache.clear();
assert.equal(cache.stats().weight, 0);
const cells = [{
    id: 'home',
    x: 600,
    y: 500,
    w: 8,
    h: 8,
    area: .13,
    people: 10000,
    jobs: 0,
    shops: 100,
    industry: 0,
    leisure: 100
  }, {
    id: 'work',
    x: 760,
    y: 500,
    w: 8,
    h: 8,
    area: .13,
    people: 1000,
    jobs: 6000,
    shops: 2000,
    industry: 0,
    leisure: 1000
  }],
  city = {
    cells,
    totals: {
      people: 11000,
      jobs: 6000,
      shops: 2100,
      industry: 0,
      leisure: 1100
    },
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  };
const clean = v => JSON.parse(JSON.stringify(v, (key, value) => ['calculationMs', 'memory'].includes(key) ?
  undefined : value));
const forecast = D.evaluate(s, city);
assert(forecast.riders > 0);
const compactMethod = X.compactPaths,
  atMethod = X.pathAt;
try {
  X.compactPaths = (...args) => {
    const paths = oldPaths(...args);
    Object.defineProperty(paths, 'memoryWeight', {
      value: 1
    });
    return paths;
  };
  X.pathAt = (tree, id) => tree[id];
  assert.deepEqual(clean(D.evaluate(s, city)), clean(forecast));
} finally {
  X.compactPaths = compactMethod;
  X.pathAt = atMethod;
}
const slim = Snapshot.capture(s);
assert.deepEqual(clean(D.evaluate(slim, city)), clean(forecast));
assert.deepEqual(P.definitions(slim, forecast), P.definitions(s, forecast));
const large = structuredClone(s);
large.operationsReview = {
  extra: 'x'.repeat(1000000)
};
large.log = ['x'.repeat(1000000)];
const projected = Snapshot.capture(large);
assert(!('operationsReview' in projected));
assert(!('log' in projected));
assert(!('ledger' in projected.economy));
assert(!('history' in projected.ridership));
assert(JSON.stringify(projected).length < JSON.stringify(large).length / 20);
const audit = Audit.create(4),
  rt = P.create(s, forecast, 480, false);
for (let i = 0; i < 20; i++) audit.record('test', s, forecast, rt);
assert.equal(audit.history().length, 4);
assert.equal(audit.latest().flows, forecast.flows.length);
audit.tick(1000, s, forecast, rt);
assert.equal(audit.tick(1001, s, forecast, rt), undefined);
// Continuous passengers through repeated forecast refreshes and checkpoint recovery.
s.economy.minute = 480;
for (let i = 0; i < 120; i++) {
  M.advance(s, rt, 1);
  if (i % 30 === 0) P.rebase(rt, s, D.evaluate(s, city));
}
const totals = P.summary(rt);
assert(totals.generated > 0);
assert(Math.abs(totals.generated - totals.waiting - totals.onboard - totals.completed - totals.cancelled) <
  1e-5);
const save = LS.parse(JSON.stringify(LS.pack(s, P.snapshot(rt))));
assert(P.restore(save.state, D.evaluate(save.state, city), save.runtime));
async function queueContracts() {
  const queue = Queue.create();
  let release, executed = 0,
    concurrent = 0,
    max = 0;
  const first = queue.request(async () => {
    executed++;
    max = Math.max(max, ++concurrent);
    await new Promise(r => release = r);
    concurrent--;
    return 'first';
  });
  let latest;
  const pending = [];
  for (let i = 0; i < 1000; i++) {
    latest = i;
    pending.push(queue.request(() => {
      executed++;
      max = Math.max(max, ++concurrent);
      concurrent--;
      return latest;
    }));
  }
  assert(pending.every(p => p === pending[0]), 'one pending promise, not 1000 payloads');
  assert.equal(queue.stats().started, 1);
  assert(queue.stats().pending);
  await Promise.resolve();
  release();
  assert.equal(await first, 'first');
  assert.equal(await pending.at(-1), 999);
  await queue.flush();
  assert.equal(executed, 2);
  assert.equal(max, 1);
  assert(!queue.stats().active && !queue.stats().pending);
  let stored;
  const db = DB.create({
    get: async () => stored,
    put: async (k, v) => {
      stored = v;
    }
  }, null);
  await queue.request(() => db.write('test', {
    good: true
  }));
  const good = stored.text;
  await assert.rejects(queue.request(() => db.write('test', {
    toJSON() {
      throw Error('encoding');
    }
  })), /encoding/);
  assert.equal(stored.text, good);
  await queue.request(() => db.write('test', {
    recovered: true
  }));
  await queue.flush();
  assert.deepEqual(JSON.parse((await db.read('test')).text), {
    recovered: true
  });
}
queueContracts().then(() => console.log(
  'MAP40 passed: exact MAP39 routes/OD/fare parity, compact path boundaries, weighted cache limits, lean demand parity, bounded telemetry, 1001 save requests→2 serial encodes, failure recovery, two simulated hours with repeated rebase, passenger conservation and save restore.'
  )).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
