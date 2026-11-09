/* Isolated MAP51/current whole management workloads. No timing instrumentation inside kernels. */
const {
  spawnSync
} = require('node:child_process');
if (!['map51', 'map52'].includes(process.argv[2])) {
  const size = process.argv[2] || '5',
    rounds = Number(process.argv[3]) || 4,
    results = [];
  for (let round = 0; round < rounds; round++)
    for (const mode of round % 2 ? ['map52', 'map51'] : ['map51', 'map52']) {
      const r = spawnSync(process.execPath, ['--expose-gc', __filename, mode, size, process.argv[
        4] || 'batch', process.argv[5] || '0'
      ], {
        encoding: 'utf8',
        timeout: 180000
      });
      if (r.status) throw Error(r.stderr);
      results.push({
        ...JSON.parse(r.stdout),
        round: round + 1
      });
    }
  if (results.some(r => r.checksum !== results[0].checksum)) throw Error(
    'Management full-state checksum mismatch');
  const summary = ['map51', 'map52'].map(backend => {
    const group = results.filter(r => r.backend === backend),
      ms = group.flatMap(r => r.samplesMs).sort((a, b) => a - b);
    return {
      backend,
      lines: group[0].lines,
      stations: group[0].stations,
      medianMs: (ms[Math.floor((ms.length - 1) / 2)] + ms[Math.floor(ms.length / 2)]) / 2,
      maxRssMB: Math.max(...group.map(r => r.rssMB)),
      maxHeapMB: Math.max(...group.map(r => r.heapMB)),
      checksum: group[0].checksum
    };
  });
  console.log(JSON.stringify({
    workload: 'Alternating version order; each isolated process: 30 warmup minutes + 5 x 120 game minutes; full operating/accounting state parity',
    requestMode: process.argv[4] === 'ui' ? 'MAP49: 1200 x .1-minute requests; MAP51: 120 budget batches x 1 minute, same .1-minute quanta' : 'one 120-minute batch per sample',
    rounds,
    facilities:Number(process.argv[5])||0,
    summary,
    results
  }, null, 2));
} else {
  const old = process.argv[2] === 'map51';
  const P = old ? require('./fixtures/rail-map51-passengers.cjs') : require('../rail/passengers');
  const M = old ? require('./fixtures/rail-map51-management.cjs') : require('../rail/management');
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
  const facilities=Number(process.argv[5])||0;
  if(facilities) {
    const U=require('../rail/urban-growth');U.init(s);
    const kinds=Object.keys(U.TYPES);
    s.urban.facilities=Array.from({length:facilities},(_,i)=>({id:'f'+i,
      kind:kinds[i%kinds.length],level:1,x:s.nodes[(i*7)%s.nodes.length].x+i%3,
      y:s.nodes[(i*7)%s.nodes.length].y+i%5}));
  }
  const f = D.evaluate(s, {
    cells,
    totals: Object.fromEntries(fields.map(k => [k, cells.reduce((v, c) => v + c[k], 0)])),
    metadata: {
      effectiveConnections: true,
      demandZoneUnits: 40
    }
  });
  // Forecast buffers are not part of the continuous simulation working set.
  require('../rail/routing-wasm').recycleSimulation();
  if(old) require('./fixtures/rail-map51-routing-wasm.cjs').recycleSimulation();
  const rt = P.create(s, f, 480, false);
  s.economy.minute = 480;
  M.advance(s, rt, 30);
  global.gc();
  const statusStart=require('../rail/routing-wasm').status();
  const ms = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    if (process.argv[4] === 'ui') {
      if(old) {for(let tick=0;tick<1200;tick++) M.advance(s,rt,.1);}
      else {for(let frame=0;frame<120;frame++) M.advanceBudget(s,rt,1,{budget:1e6,maxSteps:100,now:()=>0,nativeLoop:true});}
    } else M.advance(s, rt, 120);
    ms.push(performance.now() - start);
    global.gc();
  }
  if(process.env.RAIL_BENCH_DUMP)require('node:fs').writeFileSync(process.env.RAIL_BENCH_DUMP,JSON.stringify({state:s,snapshot:P.snapshot(rt),defs:rt.defs}));
  console.log(JSON.stringify({
    backend: process.argv[2],
    projection:require('../rail/routing-wasm').status(),
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
