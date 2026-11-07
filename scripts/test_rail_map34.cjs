/* Worker parity, compact live snapshots and checkpoint failure isolation. */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path');
const N = require('../rail/network'),
  M = require('../rail/management'),
  Q = require('../rail/ridership'),
  C = require('../rail/city'),
  P = require('../rail/passengers'),
  OC = require('../rail/operations-center'),
  Metrics = require('../rail/metrics'),
  DB = require('../rail/save-store');
const s = M.init(N.upgrade(N.emptyWorld('gba')));
for (let i = 0; i < 4; i++) assert(!N.addLine(s, Array.from({
  length: 6
}, (_, j) => ({
  x: 600 + j * 10,
  y: 500 + i * 10
})), {
  stockSpec: '6B'
}).error);
Q.enableSatisfaction(s);
const f = C.evaluate(s),
  rt = P.create(s, f, 480, false);
const plan = rt.plan.services[0];
rt.trains = [{
  parentLine: s.services[0].id,
  service: plan.id,
  onboard: 120,
  capacity: 100
}];
rt.queues = {
  [plan.id + '|1|' + s.services[0].stops[0]]: {
    '0:0': 80,
    '1:0': 40
  }
};
rt.outside = {
  [s.services[0].stops[0]]: {
    '0': 50,
    '1': 25
  }
};

function worker(file) {
  const sent = [],
    context = vm.createContext({
      performance,
      console,
      URL,
      WebAssembly,
      Float64Array,
      location: {
        href: 'https://test.invalid/rail/operations-worker.js'
      },
      fetch: async () => ({
        ok: true,
        arrayBuffer: async () => {
          const b = fs.readFileSync(path.join(__dirname, '../rail/wasm/rail-core-v7.wasm'));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
        }
      }),
      postMessage: m => sent.push(structuredClone(m)),
      setTimeout,
      clearTimeout
    });
  context.self = context;
  context.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../rail', file.split('?')[0]), 'utf8'), context);
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../rail', file), 'utf8'), context);
  return {
    send: m => context.onmessage({
      data: structuredClone(m)
    }),
    sent
  };
}
const slim = {
    ...s,
    urban: undefined,
    ridership: {
      model: s.ridership.model,
      lines: s.ridership.lines
    },
    economy: {
      minute: s.economy.minute
    }
  },
  compact = {
    minute: rt.minute,
    trains: rt.trains,
    queues: Object.fromEntries(Object.entries(rt.queues).map(([k, q]) => [k, {
      total: Object.values(q).reduce((a, b) => a + b, 0)
    }])),
    outside: Object.fromEntries(Object.entries(rt.outside).map(([k, q]) => [k, {
      total: Object.values(q).reduce((a, b) => a + b, 0)
    }]))
  };
(async () => {
  const before = JSON.stringify({
      s,
      rt
    }),
    w = worker('operations-worker.js');
  await w.send({
    id: 1,
    version: 1,
    state: slim,
    runtime: compact,
    forecast: f
  });
  const clean = x => JSON.parse(JSON.stringify(x));
  assert(!w.sent[0].error, w.sent[0].error);
  assert.deepEqual(clean(w.sent[0].rows), clean(OC.analyze(s, f, rt)));
  assert.deepEqual(clean(w.sent[0].metrics), clean(Metrics.summary(s, f)));
  await w.send({
    id: 2,
    version: 1,
    state: slim,
    runtime: compact
  });
  assert.deepEqual(clean(w.sent[1].rows), clean(w.sent[0].rows));
  await w.send({
    id: 3,
    version: 2,
    state: slim,
    runtime: compact
  });
  assert.match(w.sent[2].error, /版本/);
  assert.equal(JSON.stringify({
    s,
    rt
  }), before);
  const sw = worker('save-worker.js'),
    value = {
      state: s,
      runtime: P.snapshot(rt),
      large: 'x'.repeat(9 * 1024 * 1024)
    };
  await sw.send({
    id: 1,
    value
  });
  assert.equal(sw.sent[0].text, JSON.stringify(value));
  assert.equal(sw.sent[0].id, 1);
  let stored;
  const adapter = {
    get: async () => stored,
    put: async (k, v) => {
      stored = v;
    }
  };
  let rejectNext = false;
  const db = DB.create(adapter, null, v => rejectNext ? Promise.reject(Error('worker failed')) : Promise.resolve(JSON.stringify(v)));
  await db.write('test', value);
  const good = stored.text;
  rejectNext = true;
  await assert.rejects(db.write('test', {
    bad: true
  }), /worker failed/);
  assert.equal(stored.text, good);
  rejectNext = false;
  await db.write('test', {
    recovered: true
  });
  assert.deepEqual(JSON.parse((await db.read('test')).text), {
    recovered: true
  });
  console.log('MAP34 passed: diagnostic Worker exact parity, forecast reuse/version rejection, compact queue equivalence, read-only state/runtime, 9MB worker JSON roundtrip, last-good preservation on serialization failure and successful retry.');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});