/* Whole editor calls on identical complete worlds; input copies stay outside timing. */
const path = require('node:path'),
  fs = require('node:fs'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict'),
  {
    performance
  } = require('node:perf_hooks');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..')),
  N = require(path.join(root, 'rail/network')),
  X = require(path.join(root, 'rail/service-plan'));
const Core = fs.existsSync(path.join(root, 'rail/routing-wasm.js')) ? require(path.join(root,
  'rail/routing-wasm')) : null;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const points = (i) => Array.from({
  length: 6
}, (_, j) => ({
  x: 600 + j * 12,
  y: 500 + i * 15,
  nameSeed: (j + 1) / 7
}));
const rows = [];

function measure(base, label, method, args, success) {
  const before = hash(base),
    raw = [];
  let resultState;
  const perform = () => {
    const state = structuredClone(base),
      result = N[method](state, ...structuredClone(args));
    assert(!result?.error, JSON.stringify(result));
    if (success) assert(success(state, result));
    return {
      state,
      result
    };
  };
  for (let i = 0; i < 8; i++) perform();
  for (let r = 0; r < 7; r++) {
    const worlds = Array.from({
        length: 5
      }, () => structuredClone(base)),
      a = worlds.map(() => structuredClone(args));
    const start = performance.now();
    let result;
    for (let i = 0; i < 5; i++) {
      result = N[method](worlds[i], ...a[i]);
      assert(!result?.error, JSON.stringify(result));
      if (success) assert(success(worlds[i], result));
    }
    raw.push((performance.now() - start) / 5);
    resultState = {
      state: worlds.at(-1),
      result
    };
  }
  assert.equal(hash(base), before);
  rows.push({
    label,
    lines: base.services.length,
    stations: base.nodes.length,
    rawMs: raw,
    ms: [...raw].sort((a, b) => a - b)[3],
    outputHash: hash(resultState)
  });
}
for (const lines of [4, 10]) {
  const s = N.emptyWorld('gba');
  for (let i = 0; i < lines; i++) assert(!N.addLine(s, points(i), {
    stockSpec: '6B'
  }).error);
  s.depot.stock['6B'] = lines * 8 + 12;
  for (const l of [...s.services]) assert(!N.configure(s, l.id, {
    dispatch: {
      mode: 'manual',
      manual: 8,
      offPeak: 8,
      peak: 8
    }
  }).error);
  assert(N.validate(s));
  const l = s.services[0];
  measure(s, 'add six-station line', 'addLine', [points(lines), {
    stockSpec: '6B'
  }], v => v.services.length === lines + 1);
  measure(s, 'insert station', 'addStation', [l.id, {
    x: 630,
    y: 506,
    nameSeed: .2
  }, {
    index: 3
  }], v => v.services[0].stops.length === 7);
  measure(s, 'remove station', 'removeStation', [l.id, l.stops[2]], v => v.services[0].stops.length === 5);
  measure(s, 'configure local and express', 'configure', [l.id, {
    name: 'batch',
    dispatch: {
      mode: 'manual',
      manual: 4,
      offPeak: 4,
      peak: 4
    },
    patterns: [{
      kind: 'local',
      from: 0,
      to: 5,
      fleet: 2,
      headway: 8
    }, {
      kind: 'express',
      from: 0,
      to: 5,
      calls: [l.stops[2], l.stops[4]],
      fleet: 2,
      headway: 8
    }]
  }]);
  measure(s, 'delete line', 'removeLine', [l.id], v => v.services.length === lines - 1);
  const merge = structuredClone(s),
    b = merge.services[1].stops[0];
  merge.nodes[b].x = merge.nodes[0].x + .5;
  merge.nodes[b].y = merge.nodes[0].y;
  for (const t of merge.tracks) delete t.curve;
  for (const line of merge.services) X.geometry(merge, line);
  assert(N.validate(merge));
  measure(merge, 'merge nearby stations', 'mergeNearby', [], (_, count) => count === 1);
  let inputBytes = 0,
    outputBytes = 0,
    commands = 0;
  if (Core) {
    const kernel = Core.kernel;
    Core.kernel = function(name, v, ...rest) {
      const out = kernel(name, v, ...rest);
      if (name === 'editor_run') {
        inputBytes += v.byteLength??v.length*8;
        outputBytes += out.byteLength;
        commands++;
      }
      return out;
    };
    try {
      N.configure(structuredClone(s), l.id, {
        name: 'probe'
      });
    } finally {
      Core.kernel = kernel;
    }
  }
  rows.push({
    label: 'boundary diagnostics',
    lines,
    stations: s.nodes.length,
    inputBytes,
    outputBytes,
    commands
  });
}
console.log(JSON.stringify({
  root,
  node: process.version,
  rows
}));
