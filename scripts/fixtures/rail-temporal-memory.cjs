/* The 151056-profile transport must not retain unused legacy inputs or duplicate group-index buffers. */
const S = require('../../rail/simulation-wasm');
const n = 151056,
  catalog = Array.from({
    length: n
  }, () => ({
    daily: .00001,
    purpose: 'work',
    back: false,
    hub: false,
    lineIds: ['a'],
    externalKind: null
  }));
// Warm both native metadata allocations and scratch capacity before measuring JS buffers.
// This avoids making the budget depend on a Node version's WASM-memory accounting.
function warmNative() {
  const warm = Array(n + 128).fill({
    daily: 0,
    purpose: 'work',
    back: false,
    hub: false,
    lineIds: []
  });
  S.arrivals(warm, () => 1, () => 0, 0, 123);
}
warmNative();
warmNative();
global.gc();
const before = process.memoryUsage().arrayBuffers;
S.timedArrivals(catalog, {}, 480, 1, 0, 123, true);
global.gc();
global.gc();
console.log(JSON.stringify({
  profiles: n,
  arrayBufferGrowth: process.memoryUsage().arrayBuffers - before
}));
