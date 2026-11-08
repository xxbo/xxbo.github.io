/* Optional 12-hour continuous game workload with hourly forecast and JSON roundtrips. */
const assert = require('node:assert/strict'),
  {
    create
  } = require('./fixtures/rail-memory-grid.cjs'),
  D = require('../rail/demand-model'),
  P = require('../rail/passengers'),
  M = require('../rail/management'),
  LS = require('../rail/local-save');
const s = create(5),
  cells = s.nodes.map((n, i) => ({
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
  })),
  totals = {
    people: 0,
    jobs: 0,
    shops: 0,
    industry: 0,
    leisure: 0
  };
for (const c of cells)
  for (const k of Object.keys(totals)) totals[k] += c[k];
const city = {
  cells,
  totals,
  metadata: {
    effectiveConnections: true,
    demandZoneUnits: 40
  }
};
let forecast = D.evaluate(s, city);
const rt = P.create(s, forecast, 480, false);
s.economy.minute = 480;
const measurements = [],
  start = performance.now();
let peak = 0;
for (let hour = 0; hour < 12; hour++) {
  let pending=60;
  while(pending>1e-8) {
    const result=M.advanceBudget(s,rt,pending,{budget:6,maxSteps:100});
    assert(result.running);assert(result.remaining<pending);pending=result.remaining;
  }
  forecast = D.evaluate(s, city);
  const before = P.summary(rt);
  P.rebase(rt, s, forecast);
  assert.deepEqual(P.summary(rt), before);
  const sum = P.summary(rt);
  assert(Math.abs(sum.generated - sum.waiting - sum.onboard - sum.completed - sum.cancelled) < 1e-5);
  const packed = LS.pack(s, P.snapshot(rt)),
    text = JSON.stringify(packed),
    loaded = LS.parse(text);
  assert(P.restore(loaded.state, forecast, loaded.runtime));
  assert(forecast.diagnostics.memory.routeTrees.peakWeight <= 60000);
  assert(forecast.diagnostics.memory.strategies.peak <= 1024);
  if (global.gc) global.gc();
  const heap = process.memoryUsage().heapUsed;
  peak = Math.max(peak, heap);
  measurements.push({
    hour: hour + 1,
    heapMB: +(heap / 1048576).toFixed(2),
    profiles: P.demandSummary(rt).profiles,
    realized: rt.defs.length,
    trains: rt.trains.length,
    saveMB: +(Buffer.byteLength(text) / 1048576).toFixed(2)
  });
}
console.log(JSON.stringify({
  lines: s.services.length,
  stations: s.nodes.length,
  gameHours: 12,
  recalculations: 12,
  saveRoundtrips: 12,
  conservation: true,
  completed: rt.completed,
  generated: rt.generated,
  wallMs: +(performance.now() - start).toFixed(0),
  peakSampledHeapMB: +(peak / 1048576).toFixed(2),
  peakProcessRSSMB: +(process.resourceUsage().maxRSS / 1024).toFixed(2),
  measurements
}, null, 2));
