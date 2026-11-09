/* Same valid input across repository roots, no timed world construction. */
const path = require('node:path'),
  assert = require('node:assert/strict'),
  {
    performance
  } = require('node:perf_hooks');
const {
  world
} = require('./fixtures/rail-map61-validation-world.cjs');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..')),
  X = require(path.join(root, 'rail/service-plan')),
  N = require(path.join(root, 'rail/network'));
const fs = require('node:fs'),
  core = fs.existsSync(path.join(root, 'rail/routing-wasm.js')) ? require(path.join(root,
    'rail/routing-wasm')) : null;
const hash=v=>require('node:crypto').createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rows = [];

function measure(label, details, run) {
  const raw = [];
  for (let i = 0; i < 10; i++) assert(run(i));
  for (let k = 0; k < 7; k++) {
    const t = performance.now();
    for (let i = 0; i < 5; i++) assert(run(i));
    raw.push((performance.now() - t) / 5);
  }
  rows.push({
    label,
    ...details,
    ms: [...raw].sort((a, b) => a - b)[3],
    rawMs: raw
  });
}
for (const lines of [10, 40])
  for (const patterns of [1, 5]) {
    const s = world(lines, patterns),
      before = JSON.stringify(s);
    assert(X.validate(s));
    measure('plan validation', {
      lines,
      patterns,
      stationsPerLine: 20
    }, () => X.validate(s));
    assert.equal(JSON.stringify(s), before);
    let inputBytes = 0,
      outputBytes = 0;
    if (core) {
      const kernel = core.kernel;
      core.kernel = function(name, v, ...rest) {
        const out = kernel(name, v, ...rest);
        if (name === 'service_validate') {
          inputBytes = v.byteLength;
          outputBytes = out.byteLength;
        }
        return out;
      };
      try {
        assert(X.validate(s));
      } finally {
        core.kernel = kernel;
      }
    }
    Object.assign(rows.at(-1), {
      inputBytes,
      outputHash:hash(s),
      outputBytes
    });
  }
for (const lines of [4, 10]) {
  const s = N.emptyWorld('gba');
  for (let i = 0; i < lines; i++) assert(!N.addLine(s, Array.from({
    length: 10
  }, (_, j) => ({
    x: 600 + j * 10,
    y: 500 + i * 10,
    nameSeed:.1
  }))).error);
  const id = s.services[0].id;
  measure('configure name', {
    lines,
    stationsPerLine: 10
  }, i => !N.configure(s, id, {
    name: 'bench ' + i
  }).error);
  rows.at(-1).outputHash=hash(s);
  const before = JSON.stringify(s);
  measure('delete line including input clone', {
    lines,
    stationsPerLine: 10
  }, () => {
    const c = structuredClone(s),
      r = N.removeLine(c, id);
    return !r.error && c.services.length === lines - 1;
  });
  assert.equal(JSON.stringify(s), before);
  const result=structuredClone(s);assert(!N.removeLine(result,id).error);rows.at(-1).outputHash=hash(result);
}
console.log(JSON.stringify({
  root,
  node: process.version,
  rows
}));
