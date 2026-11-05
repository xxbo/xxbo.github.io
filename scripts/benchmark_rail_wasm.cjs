/* Same bounded cache and retained results: MAP40 JS versus production Rust/WASM. */
const {
  spawnSync
} = require('node:child_process');
if (!process.argv[2]) {
  const results = [];
  for (const backend of ['map40-js', 'rust-wasm']) {
    const result = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=512', __filename, backend], {
      encoding: 'utf8',
      timeout: 120000
    });
    if (result.status !== 0) throw Error(result.stderr || result.error?.message);
    results.push(JSON.parse(result.stdout));
  }
  if (results[0].checksum !== results[1].checksum) throw Error('Route checksum mismatch');
  console.log(JSON.stringify({
    workload: '14 lines / 49 stations; 36 origin-value groups; all destinations; same LRU budgets',
    results
  }, null, 2));
} else {
  const {
    create
  } = require('./fixtures/rail-memory-grid.cjs');
  const X = require('../rail/service-plan'),
    Cache = require('../rail/bounded-cache');
  const core = process.argv[2] === 'map40-js' ? require('./fixtures/rail-map40-routing.cjs') : X;
  const s = create(),
    graph = X.network(s),
    samples = [];
  let checksum = 0,
    cache;

  function workload() {
    cache = Cache.create({
      limit: 24,
      maxWeight: 60000,
      weight: trees => trees.reduce((n, t) => n + t.memoryWeight, 0)
    });
    let sum = 0;
    for (let from = 0; from < 12; from++)
      for (const value of [.025, .04, .05]) {
        const trees = [...new Set(graph[from].map(e => e.service + '|' + e.dir))].map(first => core.compactPaths(s, graph, from, value, first));
        cache.set(from + '|' + value, trees);
        for (const tree of trees)
          for (let to = 0; to < s.nodes.length; to++) {
            const p = core.pathAt(tree, to);
            if (p) sum += p.edges.length;
          }
      }
    checksum = sum;
  }
  workload();
  cache = null;
  global.gc();
  const initial = process.memoryUsage();
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    workload();
    samples.push(performance.now() - start);
    if (i < 2) cache = null;
    global.gc();
  }
  const end = process.memoryUsage();
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({
    backend: process.argv[2],
    medianMs: +samples[1].toFixed(1),
    checksum,
    retainedJsHeapMB: +((end.heapUsed - initial.heapUsed) / 1048576).toFixed(2),
    retainedArrayBufferMB: +((end.arrayBuffers - initial.arrayBuffers) / 1048576).toFixed(2),
    wasmLinearMB: process.argv[2] === 'rust-wasm' ? X.routingStatus().memoryBytes / 1048576 : 0,
    peakProcessRSSMB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
    cache: cache.stats()
  }));
}