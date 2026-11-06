const Sim = require('../rail/simulation-wasm'),
  Core = require('../rail/routing-wasm');
const metrics = {};

function wrap(object, key) {
  const original = object[key];
  object[key] = function(...args) {
    const start = performance.now();
    const result = original.apply(this, args);
    const m = metrics[key] || (metrics[key] = {
      calls: 0,
      ms: 0
    });
    m.calls++;
    m.ms += performance.now() - start;
    return result;
  };
}
for (const name of ['motion', 'incremental', 'boarding', 'dispatch', 'arrivals']) wrap(Sim, name);
const kernel = Core.kernel;
Core.kernel = function(name, input, ...args) {
  const start = performance.now();
  const result = kernel(name, input, ...args);
  if (name === 'simulation_run' || name === 'simulation_step') {
    const op = name === 'simulation_step' ? 'queue' : 'op' + input[0],
      m = metrics[op] || (metrics[op] = {
        calls: 0,
        ms: 0,
        inputBytes: 0,
        fullSyncs: 0
      });
    m.calls++;
    m.ms += performance.now() - start;
    m.inputBytes += input.length * 8;
    if ((input[0] === 4 && input[4]) || (name === 'simulation_step' && input[3])) m.fullSyncs++;
  }
  return result;
};
const P = require('../rail/passengers'),
  D = require('../rail/demand-model'),
  {
    create
  } = require('./fixtures/rail-memory-grid.cjs');
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
const rt = P.create(s, D.evaluate(s, city), 480, false);
P.advance(rt, s, 10);
for (const k of Object.keys(metrics)) delete metrics[k];
const start = performance.now();
P.advance(rt, s, 60);
console.log(JSON.stringify({
  totalMs: performance.now() - start,
  metrics
}, null, 2));
