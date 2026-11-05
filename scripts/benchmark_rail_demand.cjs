/* MAP42 versus MAP43 whole forecasts; separate processes, deterministic inputs and exact checksums. */
const {
  spawnSync
} = require('node:child_process');
if (!process.argv[2]) {
  const results = [];
  for (const mode of ['map42-mixed', 'rust-wasm']) {
    const r = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=512', __filename, mode], {
      encoding: 'utf8',
      timeout: 180000
    });
    if (r.status !== 0) throw Error(r.stderr || r.error?.message);
    results.push(JSON.parse(r.stdout));
  }
  if (results[0].checksum !== results[1].checksum) throw Error('Demand checksum mismatch');
  console.log(JSON.stringify({
    workload: '200-zone OD distribution; 1200 mode choices; 800 strategies; 10-line/25-station complete demand; 3 measured rounds after warmup',
    results
  }, null, 2));
} else {
  const D = process.argv[2] === 'map42-mixed' ? require('./fixtures/rail-map42-demand.cjs') : require('../rail/demand-model');
  const {
    create
  } = require('./fixtures/rail-memory-grid.cjs'), crypto = require('node:crypto');
  const cells = Array.from({
    length: 200
  }, (_, i) => ({
    id: 'c' + i,
    x: 600 + i % 20 * 40,
    y: 500 + Math.floor(i / 20) * 40,
    w: 8,
    h: 8,
    area: .13,
    people: 800 + i % 3 * 210,
    jobs: 400 + i % 4 * 180,
    shops: 120 + i % 5 * 80,
    industry: 40,
    leisure: 90
  }));
  const totals = Object.fromEntries(['people', 'jobs', 'shops', 'industry', 'leisure'].map(k => [k, cells.reduce((v, c) => v + c[k], 0)]));
  const makeCity = () => ({
    cells,
    totals,
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  });
  const state = create(5),
    smallCells = state.nodes.map((n, i) => ({
      ...cells[i],
      x: n.x,
      y: n.y
    }));
  const small = {
    cells: smallCells,
    totals: Object.fromEntries(Object.keys(totals).map(k => [k, smallCells.reduce((v, c) => v + c[k], 0)])),
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  };
  const paths = Array.from({
    length: 8
  }, (_, i) => ({
    minutes: 10 + i * 3,
    fare: 180 + i * 20,
    edges: [{
      service: 'p' + i,
      dir: 1,
      headway: 4 + i
    }]
  }));

  const Core=require('../rail/routing-wasm');
  function run() {
    const timings = {},
      result = {},
      time = (key, fn) => {
        const t = performance.now();
        result[key] = fn();
        timings[key] = performance.now() - t;
      };
    time('odMs', () => D.distribution(makeCity()).matrices);
    time('modesMs', () => {
      let sum = 0;
      for (let i = 0; i < 1200; i++) sum += D.modeShare({
        purpose: 'work',
        minutes: 10 + i % 60,
        access: i % 30,
        fare: 180 + i % 600,
        km: 3 + i % 35
      });
      return sum;
    });
    time('strategiesMs', () => {
      let sum = 0;
      for (let i = 0; i < 800; i++) sum += D.strategy(paths, i % 2 ? 'work' : 'leisure').expected;
      return sum;
    });
    time('forecastMs', () => {
      const before=Core.status();
      const f = D.evaluate(state, small);
      const after=Core.status();
      forecastCalls=after.demandCalls-before.demandCalls;
      return {
        riders: f.riders,
        unserved: f.unserved,
        trackFlow: f.trackFlow,
        serviceFlow: f.serviceFlow
      };
    });
    const hash = crypto.createHash('sha256');
    for (const key of ['work', 'shopping', 'leisure']) hash.update(Buffer.from(result.odMs[key].buffer, result.odMs[key].byteOffset, result.odMs[key].byteLength));
    hash.update(JSON.stringify({
      modes: result.modesMs,
      strategies: result.strategiesMs,
      forecast: result.forecastMs
    }));
    return {
      timings,
      checksum: hash.digest('hex')
    };
  }
  let forecastCalls=0;
  run();
  global.gc();
  const samples = [],
    start = process.memoryUsage();
  let last;
  for (let i = 0; i < 3; i++) {
    last = run();
    samples.push(last.timings);
    global.gc();
  }
  const median = key => +samples.map(s => s[key]).sort((a, b) => a - b)[1].toFixed(2),
    end = process.memoryUsage();
  console.log(JSON.stringify({
    backend: process.argv[2],
    forecastBoundaryCalls:forecastCalls,
    median: {
      odMs: median('odMs'),
      modesMs: median('modesMs'),
      strategiesMs: median('strategiesMs'),
      forecastMs: median('forecastMs')
    },
    checksum: last.checksum,
    peakProcessRSSMB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
    jsHeapDeltaMB: +((end.heapUsed - start.heapUsed) / 1048576).toFixed(2),
    wasmLinearMB: require('../rail/routing-wasm').status().memoryBytes / 1048576
  }));
}