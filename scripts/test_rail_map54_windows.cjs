/* Compare full worlds/saves to independent MAP52 while observing real native loop spans. */
const assert = require('node:assert/strict');
const threads = require('node:worker_threads'), Base = threads.Worker, spans = [];
threads.Worker = class extends Base {
  constructor(...args) {
    super(...args);
    this.requests = new Map();
    this.on('message', data => {
      const request = this.requests.get(data.id);
      this.requests.delete(data.id);
      if (request?.name === 'engine_loop' && data.result?.[1] > 0) {
        spans.push({start: request.start, steps: data.result[1], end: request.start + data.result[1] * .1});
      }
    });
  }
  postMessage(data, ...args) {
    this.requests.set(data.id, {name: data.name, start: data.input?.[1]});
    return super.postMessage(data, ...args);
  }
};
const P = require('../rail/passengers'), M = require('../rail/management'), D = require('../rail/demand-model');
const OldP = require('./fixtures/rail-map52-passengers.cjs'), OldM = require('./fixtures/rail-map52-management.cjs');
const {create} = require('./fixtures/rail-memory-grid.cjs');
const FLOW = require('../rail/flow-history');
const options = {budget: 1e6, maxSteps: 10000, now: () => 0};
(async () => {
  let checks = 0;
  for (const start of [434.85, 1859.85, 420 + 32 * 1440 - .15]) for (const populated of [false, true]) {
    const s = create(3), cells = s.nodes.map((n, i) => ({id: 'c' + i, x: n.x, y: n.y, w: 8, h: 8, area: .13,
      people: populated ? 3000 + i * 200 : 0, jobs: populated ? 1500 + i * 100 : 0, shops: populated ? 500 : 0, industry: 0, leisure: 0}));
    const forecast = D.evaluate(s, {cells, totals: Object.fromEntries(['people','jobs','shops','industry','leisure'].map(k => [k, cells.reduce((n,c) => n+c[k],0)])),
      metadata: {effectiveConnections: true, demandZoneUnits: 40}});
    if (start > 40000) s.ridership.history = Array.from({length: 30}, (_, i) => ({...structuredClone(s.ridership.current), number: i + 1}));
    const old = structuredClone(s), rt = P.create(s, forecast, start, false), expected = OldP.create(old, forecast, start, false);
    s.economy.minute = old.economy.minute = start;
    P.nativeViews(rt);
    try {
      for (const minutes of [.3, 17, 34, 16]) {
        const result = await M.advanceBudgetAsync(s, rt, minutes, options);
        const before = OldM.advanceBudget(old, expected, minutes, options);
        assert.deepEqual(result, before);
        assert.deepEqual(s, old, `world ${start}/${populated}/${rt.minute}`);
        const saved = await P.snapshotAsync(rt);
        assert.deepEqual(saved, OldP.snapshot(expected));
        assert.deepEqual(JSON.parse(JSON.stringify(saved)), JSON.parse(JSON.stringify(OldP.snapshot(expected))));
        for (const field of FLOW.FIELDS) for (const width of [15,30,60]) {
          assert.deepEqual(FLOW.view(s.ridership.current, field, width), FLOW.view(old.ridership.current, field, width));
        }
        assert(s.ridership.history.length <= 30);
        checks++;
      }
    } finally {P.dispose(rt);}
  }
  assert(spans.some(s => s.steps > 150 && Math.floor((s.start - 420) / 15) !== Math.floor((s.end - 420) / 15)), 'one native request must cross a statistics slot');
  assert(spans.some(s => Math.floor((s.start - 420 + 1e-7) / 1440) !== Math.floor((s.end - 420 + 1e-7) / 1440)), 'native lifecycle must now cross the former day barrier');
  console.log(`MAP54 windows: ${checks} exact worlds/saves, empty and populated windows, partial starts, 07:00 rollover, 30-day history cap; native loop crosses slots in one request.`);
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {threads.Worker = Base;});
