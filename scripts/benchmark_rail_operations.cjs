/* Isolated MAP46/current whole management workloads. No timing instrumentation inside kernels. */
const {
  spawnSync
} = require('node:child_process');
if (!['map46', 'map47'].includes(process.argv[2])) {
  const results = ['map46', 'map47'].map(mode => {
    const r = spawnSync(process.execPath, ['--expose-gc', __filename, mode, process.argv[2] ||
      '5'
    ], {
      encoding: 'utf8',
      timeout: 180000
    });
    if (r.status) throw Error(r.stderr);
    return JSON.parse(r.stdout);
  });
  if (results[0].checksum !== results[1].checksum) throw Error(
    'Management full-state checksum mismatch');
  console.log(JSON.stringify({
    workload: '30 warmup minutes, 5 x 120 game minutes, management + passengers + finance + satisfaction',
    results
  }, null, 2));
} else {
  const old = process.argv[2] === 'map46';
  const P = old ? require('./fixtures/rail-map46-passengers.cjs') : require('../rail/passengers');
  const M = old ? require('./fixtures/rail-map46-management.cjs') : require('../rail/management');
  const {
    create
  } = require('./fixtures/rail-memory-grid.cjs'), D = require('../rail/demand-model'), crypto =
    require('node:crypto');
  const s = create(Number(process.argv[3]) || 5),
    fields = ['people', 'jobs', 'shops', 'industry', 'leisure'];
  const cells = s.nodes.map((n, i) => ({
    id: 'c' + i,
    x: n.x,
    y: n.y,
    w: 8,
    h: 8,
    area: .13,
    people: 3000 + i * 200,
    jobs: 1500 + i * 100,
    shops: 500,
    industry: 50,
    leisure: 200
  }));
  const f = D.evaluate(s, {
    cells,
    totals: Object.fromEntries(fields.map(k => [k, cells.reduce((v, c) => v + c[k], 0)])),
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  });
  const rt = P.create(s, f, 480, false);
  s.economy.minute = 480;
  M.advance(s, rt, 30);
  global.gc();
  const ms = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    M.advance(s, rt, 120);
    ms.push(performance.now() - start);
    global.gc();
  }
  console.log(JSON.stringify({
    backend: process.argv[2],
    lines: s.services.length,
    stations: s.nodes.length,
    medianMs: [...ms].sort((a, b) => a - b)[2],
    samplesMs: ms,
    rssMB: process.resourceUsage().maxRSS / 1024,
    heapMB: process.memoryUsage().heapUsed / 1048576,
    checksum: crypto.createHash('sha256').update(JSON.stringify({
      snapshot: P.snapshot(rt),
      defs: rt.defs,
      state: s
    })).digest('hex')
  }));
}
