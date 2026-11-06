const previous = process.argv[2] === 'map45';
const Sim = previous ? require('./fixtures/rail-map45-simulation.cjs') : require(
    '../rail/simulation-wasm'),
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
  if (name === 'simulation_run' || name === 'simulation_step' || name === 'statistics_run') {
    const op = name === 'simulation_step' ? 'queue' : name === 'statistics_run' ? 'statistics' :
      'op' + input[0],
      m = metrics[op] || (metrics[op] = {
        calls: 0,
        ms: 0,
        inputBytes: 0,
        fullSyncs: 0
      });
    m.calls++;
    m.ms += performance.now() - start;
    m.inputBytes += input.length * 8;
    m.outputBytes = (m.outputBytes || 0) + result.length * 8;
    if (name === 'simulation_step') {
      for (let at = 17 + result[6] + result[7] * 4; at < result.length; at += 8) {
        if (result[at] === 1) m.eventRows = (m.eventRows || 0) + 1;
        else if (result[at] === 2) m.travelRows = (m.travelRows || 0) + 1;
        else if (result[at] >= 32) m.statisticsRows = (m.statisticsRows || 0) + 1;
      }
    }
    if ((input[0] === 4 && input[4]) || (name === 'simulation_step' && input[3])) m.fullSyncs++;
  }
  return result;
};
const P = previous ? require('./fixtures/rail-map45-passengers.cjs') : require(
  '../rail/passengers'),
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
  backend: previous ? 'MAP45' : 'MAP46',
  totalMs: performance.now() - start,
  metrics
}, null, 2));
