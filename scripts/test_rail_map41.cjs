/* Rust/WASM exact-result gate. Frozen JS lives only in test fixtures, never in rail/. */
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const X = require('../rail/service-plan'),
  R = require('../rail/engine'),
  D = require('../rail/demand-model');
const Router = require('../rail/routing-wasm');
const modern = require('./fixtures/rail-map40-routing.cjs');
const legacy = require('./fixtures/rail-legacy-paths.cjs');
const {
  create
} = require('./fixtures/rail-memory-grid.cjs');
const {
  fixture
} = require('./fixtures/rail-ui-scenario.cjs');
const {
  s
} = fixture();
let comparisons = 0;

function compare(state, graph, origins, old, current, constraints = true) {
  for (const origin of origins) {
    for (const value of [0, .025, .045, .05, .12]) {
      const firsts = constraints ? [null, 'nonexistent|-1', ...new Set(graph[origin].map(e => e.service + '|' + e.dir))] : [null];
      for (const first of firsts) {
        const expected = old(state, graph, origin, value, first);
        const actual = current(state, graph, origin, value, first);
        assert.deepEqual(actual, expected);
        // Same edge objects and hole placement; no route/price/float tolerances.
        for (const p of actual)
          if (p)
            for (const e of p.edges) assert(graph.some(row => row.includes(e)));
        comparisons++;
      }
    }
  }
}
compare(s, X.network(s), s.nodes.map(n => n.id), modern.paths, X.paths);
// Seeded directed, disconnected, equal-cost, same-line reversal and cross-line fare-part graphs.
let seed = 0x41574153;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
for (let sample = 0; sample < 48; sample++) {
  const nodes = 5 + sample % 7;
  const state = {
    nodes: Array.from({
      length: nodes
    }, (_, id) => ({
      id
    })),
    companies: [],
    services: Array.from({
      length: 3
    }, (_, i) => ({
      id: 'L' + i,
      fareBands: [100, 140, 200, 250, 320, 400].map(v => v + sample % 3 * 10)
    }))
  };
  const graph = state.nodes.map(() => []);
  for (let from = 0; from < nodes - 1; from++) {
    for (let n = 0; n < 2 + sample % 2; n++) {
      const to = Math.floor(random() * (nodes - 1)),
        line = Math.floor(random() * 3);
      if (to === from) continue;
      const km = [1, 6, 6 + 1e-9, 6.0001, 11, 19, 40][Math.floor(random() * 7)];
      graph[from].push({
        to,
        service: 'service-' + line,
        dir: n % 2 ? -1 : 1,
        headway: 4 + sample % 3,
        minutes: 1 + km * 1.25,
        km,
        parts: sample % 3 ? [{
          line: 'L' + line,
          km
        }] : [{
          line: 'L' + line,
          km: km / 2
        }, {
          line: 'L' + (line + 1) % 3,
          km: km / 2
        }]
      });
    }
  }
  compare(state, graph, [0, nodes - 2, nodes - 1], modern.paths, X.paths);
}
// The old 121-edge boundary is deliberately unchanged.
const chain = {
  nodes: Array.from({
    length: 125
  }, (_, id) => ({
    id
  })),
  services: [{
    id: 'L'
  }],
  companies: []
};
const chainGraph = chain.nodes.map((_, i) => i === 124 ? [] : [{
  to: i + 1,
  service: 'P',
  dir: 1,
  km: 1,
  headway: 4,
  minutes: 1,
  parts: [{
    line: 'L',
    km: 1
  }]
}]);
compare(chain, chainGraph, [0], modern.paths, X.paths);
assert(X.paths(chain, chainGraph, 0)[121]);
assert(!X.paths(chain, chainGraph, 0)[122]);
// Legacy company fares and through discounts retain their original numerical results.
const oldState = R.newGame();
for (const state of [oldState, (() => {
    const t = R.clone(oldState);
    R.through(t, t.services[1].id, t.services[2].id);
    return t;
  })()]) {
  const graph = R.network(state);
  compare(state, graph, state.nodes.map(n => n.id), legacy, R.paths, false);
}
// Graph activation alternates safely; tariffs are refreshed even when the same graph is reused.
const graph = X.network(s),
  tree = X.compactPaths(s, graph, 0),
  expected = tree.map((_, id) => X.pathAt(tree, id));
R.paths(oldState, R.network(oldState), 0);
assert.deepEqual(tree.map((_, id) => X.pathAt(tree, id)), expected);
s.services[0].fareBands = [120, 160, 200, 250, 300, 350];
assert.deepEqual(X.paths(s, graph, 0), modern.paths(s, graph, 0));
// Deterministic demand/finance input parity on a connected 10-line/25-station city.
const state = create(5),
  cells = state.nodes.map((n, i) => ({
    id: 'c' + i,
    x: n.x,
    y: n.y,
    w: 8,
    h: 8,
    area: .13,
    people: 1000 + i % 3 * 300,
    jobs: 400 + i % 4 * 100,
    shops: 200,
    industry: 50,
    leisure: 100
  }));
const totals = Object.fromEntries(['people', 'jobs', 'shops', 'industry', 'leisure'].map(k => [k, cells.reduce((a, c) => a + c[k], 0)]));
const city = {
  cells,
  totals,
  metadata: {
    effectiveConnections: true,
    demandZoneUnits: 40
  }
};
const clean = value => JSON.parse(JSON.stringify(value, (k, v) => ['calculationMs', 'memory'].includes(k) ? undefined : v));
const forecast = D.evaluate(state, city),
  methods = [X.compactPaths, X.pathAt];
try {
  X.compactPaths = modern.compactPaths;
  X.pathAt = modern.pathAt;
  assert.deepEqual(clean(D.evaluate(state, city)), clean(forecast));
} finally {
  [X.compactPaths, X.pathAt] = methods;
}
assert(forecast.riders > 0);
assert.equal(forecast.diagnostics.memory.routing, 'rust-wasm-abi1');
assert(forecast.diagnostics.memory.wasm.searches > 0);
// Instance recycling cannot invalidate caller-owned compact output. Invalid inputs never produce empty forecasts.
const bytes = fs.readFileSync(path.join(__dirname, '../rail/wasm/rail-core-v23.wasm'));
Router.create(bytes, {
  recycleBytes: 0
});
const kept = X.compactPaths(s, graph, 0),
  full = kept.map((_, id) => X.pathAt(kept, id));
for (let i = 0; i < 10; i++) X.paths(s, graph, 0);
assert.deepEqual(kept.map((_, id) => X.pathAt(kept, id)), full);
assert(Router.status().recycles >= 10);
assert.throws(() => X.paths(s, graph, -1), /Rust\/WASM/);
assert.deepEqual(X.paths(s, graph, 0), modern.paths(s, graph, 0));
Router.create(bytes, {
  recycleBytes: 64 * 1024 * 1024
});
const adapterSource = fs.readFileSync(path.join(__dirname, '../rail/routing-wasm.js'), 'utf8');
async function browserLoader() {
  for (const failure of ['404', 'corrupt', 'abi']) {
    const bad = failure === 'abi' ? new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]) : new Uint8Array([1, 2, 3]);
    const context = {
      URL,
      WebAssembly,
      Float64Array,
      location: {
        href: 'https://example.test/rail/index.html'
      },
      fetch: async () => ({
        ok: failure !== '404',
        status: 404,
        arrayBuffer: async () => bad.buffer
      })
    };
    vm.runInNewContext(adapterSource, context);
    await assert.rejects(context.RailRoutingReady);
    assert.equal(context.RailRouting.status().ready, false);
    context.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    });
    await context.RailRouting.init();
    assert.equal(context.RailRouting.status().ready, true);
  }
  for (const file of ['service-plan.js', 'engine.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../rail', file), 'utf8');
    assert(!/function (searchPaths|pushHeap|popHeap|push|pop)\(/.test(source));
  }
  const module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module).map(x => x.module + '.' + x.name).sort(), ['rail_host.json_utf8', 'rail_math.acos', 'rail_math.atan2', 'rail_math.exp', 'rail_math.hypot', 'rail_math.log', 'rail_math.log1p', 'rail_math.now', 'rail_math.pow', 'rail_math.random', 'rail_math.sin']);
  console.log(`MAP41 passed: ${comparisons} exact route trees, modern/legacy/through/loop fares, 6000-profile full-demand parity, owned buffers/recycling, trap recovery, 404/corrupt/ABI load retry; production has no JS search fallback.`);
}
browserLoader().catch(e => {
  console.error(e);
  process.exitCode = 1;
});