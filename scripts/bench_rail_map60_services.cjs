/* Standalone service expansion benchmark. Supply a repository root as argv[2]. */
const path = require('node:path'),
  {
    performance
  } = require('node:perf_hooks');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const X = require(path.join(root, 'rail/service-plan'));
const fs = require('node:fs'),
  crypto = require('node:crypto');
const core = fs.existsSync(path.join(root, 'rail/routing-wasm.js')) ? require(path.join(root,
  'rail/routing-wasm')) : null;
const median = a => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const rows = [];
for (const lines of [10, 40])
  for (const patterns of [1, 5])
    for (const edited of [false, true]) {
      const s = {
        routeModel: 9,
        economy: {
          minute: 480
        },
        services: Array.from({
          length: lines
        }, (_, i) => ({
          id: 'l' + i,
          name: 'line' + i,
          stops: Array.from({
            length: 20
          }, (_, j) => i * 20 + j),
          trackIds: Array.from({
            length: 19
          }, (_, j) => 't' + i + '_' + j),
          fleet: 40,
          stockSpec: '6B',
          fleetManaged: true,
          dispatch: {
            mode: 'auto',
            manual: 20,
            offPeak: 20,
            peak: 40
          },
          patterns: Array.from({
            length: patterns
          }, (_, j) => ({
            kind: j === 0 ? 'local' : j % 2 ? 'express' : 'short',
            from: j === 0 ? 0 : j,
            to: 19 - j,
            calls: [3, 6, 9, 12, 15],
            fleet: 2 + j * 2,
            headway: 8
          }))
        }))
      };
      const before = JSON.stringify(s),
        raw = [],
        nativeBefore = core?.status().serviceCalls || 0;
      let check = 0;
      for (let i = 0; i < 100; i++) X.expand(s, 480 + i % 2 * 120);
      for (let r = 0; r < 7; r++) {
        const start = performance.now();
        for (let i = 0; i < 300; i++) {
          if (edited) s.services[0].dispatch.peak = 20 + 2 * (i % 30);
          const o = X.expand(s, 480 + i % 2 * 120);
          check += o.services.length + o.services[0].fleet;
        }
        raw.push((performance.now() - start) / 300);
      }
      if (!edited && JSON.stringify(s) !== before) throw Error('Source changed');
      const outputHash = crypto.createHash('sha256').update(JSON.stringify(X.expand(s, 480))).digest('hex');
      let inputBytes = 0,
        outputBytes = 0;
      if (core) {
        const kernel = core.kernel;
        core.kernel = function(name, values, ...rest) {
          const data = kernel(name, values, ...rest);
          if (name === 'service_compile') {
            inputBytes = values.byteLength;
            outputBytes = data.byteLength;
          }
          return data;
        };
        try {
          X.expand(structuredClone(s), 480);
        } finally {
          core.kernel = kernel;
        }
      }
      rows.push({
        edited,
        lines,
        outputHash,
        inputBytes,
        outputBytes,
        nativeCalls: (core?.status().serviceCalls || 0) - nativeBefore,
        stationsPerLine: 20,
        patternsPerLine: patterns,
        ms: median(raw),
        rawMs: raw,
        checksum: check
      });
    }
console.log(JSON.stringify({
  root,
  node: process.version,
  rows
}));
