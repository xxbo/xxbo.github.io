/* Separate processes, identical operating state and exact final-state checksum. */
const {
  spawnSync
} = require('node:child_process');
if (!process.argv[2]) {
  const results = ['map43-js', 'rust-wasm'].map(mode => {
    const r = spawnSync(process.execPath, ['--expose-gc', __filename, mode], {
      encoding: 'utf8',
      timeout: 180000
    });
    if (r.status) throw Error(r.stderr);
    return JSON.parse(r.stdout);
  });
  if (results[0].checksum !== results[1].checksum) throw Error(
    'Continuous simulation checksum mismatch');
  console.log(JSON.stringify({
    workload: '10 lines, 25 stations; 10 warmup minutes then 3 x 60 game minutes; full state/accounting parity',
    results
  }, null, 2));
} else {
  const P = process.argv[2] === 'map43-js' ? require('./fixtures/rail-map43-passengers.cjs') :
    require('../rail/passengers');
  const {
    create
  } = require('./fixtures/rail-memory-grid.cjs'), D = require('../rail/demand-model'), crypto =
    require('node:crypto');
  const s = create(5),
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
  const city = {
    cells,
    totals: Object.fromEntries(fields.map(k => [k, cells.reduce((v, c) => v + c[k], 0)])),
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  };
  const f = D.evaluate(s, city),
    rt = P.create(s, f, 480, false);
  P.advance(rt, s, 10);
  global.gc();
  const ms = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    P.advance(rt, s, 60);
    ms.push(performance.now() - start);
    global.gc();
  }
  console.log(JSON.stringify({
    backend: process.argv[2],
    medianMs: ms.sort((a, b) => a - b)[1],
    rssMB: process.resourceUsage().maxRSS / 1024,
    heapMB: process.memoryUsage().heapUsed / 1048576,
    checksum: crypto.createHash('sha256').update(JSON.stringify({
      snapshot: P.snapshot(rt),
      defs: rt.defs,
      ridership: s.ridership
    })).digest('hex'),
    summary: P.summary(rt)
  }));
}
