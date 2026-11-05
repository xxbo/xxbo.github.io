/* Optional local benchmark, excluded from CI. Synthetic workload, not a browser FPS claim. */
const assert = require('node:assert/strict');
const N = require('../rail/network');
const old = require('./fixtures/rail-map37-stats.cjs');
const s = N.upgrade(N.emptyWorld('gba'));
for (let i = 0; i < 24; i++) {
  const result = N.addLine(s, Array.from({
    length: 6
  }, (_, j) => ({
    x: 400 + j * 24,
    y: 300 + i * 18,
    nameSeed: .25
  })), {
    stockSpec: '6B'
  });
  assert(!result.error, result.error);
}
const flows = Array.from({
  length: 60000
}, (_, i) => {
  const l = s.services[i % s.services.length],
    count = 1 + i % 5;
  return {
    from: l.stops[0],
    to: l.stops[count],
    trips: 10 + i % 11,
    path: {
      fares: {
        [l.id]: 180
      },
      edges: l.trackIds.slice(0, count).map((id, j) => ({
        service: l.id,
        to: l.stops[j + 1],
        km: s.tracks.find(t => t.id === id).km,
        parts: [{
          line: l.id
        }]
      }))
    }
  };
});
const f = {
  flows
};
const before = () => new Map(s.services.map(l => [l.id, old(s, f, l.id)]));
const after = () => N.allStats(s, f);
assert.deepEqual(after(), before());

function median(fn) {
  fn();
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return samples.sort((a, b) => a - b)[2];
}
const oldMs = median(before),
  newMs = median(after);
console.log(JSON.stringify({
  lines: s.services.length,
  flows: flows.length,
  medianOf: 5,
  oldMs: +oldMs.toFixed(2),
  newMs: +newMs.toFixed(2),
  speedup: +(oldMs / newMs).toFixed(2),
  exactParity: true
}));
