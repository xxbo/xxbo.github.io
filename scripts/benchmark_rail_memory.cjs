/* Isolated bounded Node workload; RSS is this process's peak, not browser total RAM. */
const {
  spawnSync
} = require('node:child_process');
if (!process.argv[2]) {
  const rows = [];
  for (const mode of ['before', 'after']) {
    const run = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=512', __filename, mode], {
      encoding: 'utf8',
      timeout: 120000
    });
    if (run.status !== 0) {
      process.stderr.write(run.stderr || run.error?.message || 'benchmark failed');
      process.exit(1);
    }
    rows.push(JSON.parse(run.stdout));
  }
  console.log(JSON.stringify({
    workload: '14 lines / 49 stations, 36 origin-value searches, separate processes',
    results: rows
  }, null, 2));
} else {
  const {
    create
  } = require('./fixtures/rail-memory-grid.cjs'), X = require('../rail/service-plan'), Cache = require(
    '../rail/bounded-cache'), old = require('./fixtures/rail-map39-paths.cjs');
  const mode = process.argv[2],
    s = create(),
    adj = X.network(s),
    cache = mode === 'before' ? new Map() : Cache.create({
      limit: 24,
      maxWeight: 60000,
      weight: trees => trees.reduce((n, t) => n + t.memoryWeight, 0)
    });
  global.gc();
  const initial = process.memoryUsage().heapUsed,
    start = performance.now();
  let signatures = 0;
  for (let from = 0; from < 12; from++)
    for (const value of [.025, .04, .05]) {
      const first = [...new Set(adj[from].map(e => e.service + '|' + e.dir))];
      const trees = first.map(key => mode === 'before' ? old(s, adj, from, value, key) : X.compactPaths(s,
        adj, from, value, key));
      cache.set(from + '|' + value, trees);
      for (const tree of trees)
        for (let to = 0; to < s.nodes.length; to++) {
          const path = mode === 'before' ? tree[to] : X.pathAt(tree, to);
          if (path) signatures += path.edges.length;
        }
    }
  const ms = performance.now() - start;
  global.gc();
  const retained = process.memoryUsage().heapUsed - initial;
  console.log(JSON.stringify({
    mode,
    ms: +ms.toFixed(1),
    retainedHeapMB: +(retained / 1048576).toFixed(2),
    peakProcessRSSMB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
    pathEdgeChecksum: signatures,
    cache: mode === 'before' ? {
      entries: cache.size
    } : cache.stats()
  }));
}
