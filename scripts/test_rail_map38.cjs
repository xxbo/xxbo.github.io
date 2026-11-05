/* Refactoring contracts: exact old formulas, transport parity and failed-job cleanup. */
const assert = require('node:assert/strict');
const N = require('../rail/network'),
  M = require('../rail/management');
const X = require('../rail/service-plan'),
  Q = require('../rail/ridership');
const OC = require('../rail/operations-center'),
  Metrics = require('../rail/metrics');
const Snapshot = require('../rail/diagnostic-snapshot'),
  Client = require('../rail/worker-client');
const View = require('../rail/review-view'),
  Review = require('../rail/operations-review');
const Currency = require('../rail/currency'),
  oldStats = require('./fixtures/rail-map37-stats.cjs');

function fixture() {
  const s = M.init(N.upgrade(N.emptyWorld('gba')));
  const p = (x, y) => ({
    x,
    y,
    nameSeed: .25
  });
  assert(!N.addLine(s, [p(600, 500), p(640, 500), p(680, 500), p(720, 500)], {
    stockSpec: '6B'
  }).error);
  assert(!N.addLine(s, [s.services[0].stops[1], p(640, 540), p(680, 540), s.services[0].stops[2]], {
    stockSpec: '6B'
  }).error);
  assert(!N.addLine(s, [p(780, 500), p(820, 500), p(820, 540), p(780, 500)], {
    stockSpec: '6B'
  }).error);
  require('../rail/fleet').purchase(s, '6B', 24);
  for (const l of s.services) assert(!N.configure(s, l.id, {
    dispatch: {
      mode: 'manual',
      manual: 6,
      offPeak: 4,
      peak: 6
    }
  }).error);
  const l = s.services[0],
    other = s.services[1];
  assert(!N.configure(s, l.id, {
    patterns: [{
        kind: 'local',
        from: 0,
        to: 3,
        fleet: 2,
        headway: 6
      },
      {
        kind: 'express',
        from: 0,
        to: 3,
        calls: [l.stops[0], l.stops[3]],
        fleet: 2,
        headway: 6
      },
      {
        kind: 'cross',
        from: 0,
        to: 1,
        target: other.id,
        targetEnd: 2,
        fleet: 2,
        headway: 6
      }
    ]
  }).error);
  Q.enableSatisfaction(s);
  const graph = X.network(s),
    flows = [];
  for (const from of s.nodes.map(n => n.id))
    for (const path of X.paths(s, graph, from)) {
      if (!path?.edges.length) continue;
      for (let i = 0; i < 13; i++) flows.push({
        from,
        to: path.node,
        trips: 30.125 + i / 7,
        path
      });
    }
  // Repeated fare parts on an edge must not double-count riders or station events.
  const first = flows[0];
  first.path = structuredClone(first.path);
  first.path.edges[0].parts.push({
    ...first.path.edges[0].parts[0]
  });
  // Fare-only allocations and absent parts remain valid presentation inputs.
  flows.push({
    from: 0,
    to: 1,
    trips: 12,
    path: {
      edges: [],
      fares: {
        [l.id]: 20
      },
      fare: 20,
      km: 1,
      transfers: 0
    }
  });
  const f = {
    flows,
    population: 10000,
    catchment: {
      covered: 6000
    }
  };
  const plan = X.expand(s, 480).services;
  const rt = {
    minute: 480,
    trains: plan.map((r, i) => ({
      parentLine: r.parentLine,
      service: r.id,
      onboard: i * 50,
      capacity: 1000
    })),
    queues: Object.fromEntries(plan.map((r, i) => [r.id + '|1|' + r.stops[0], {
      '0:0': i + 4,
      '1:0': i + 2
    }])),
    outside: {
      [l.stops[1]]: {
        '0': 20,
        '1': 15
      }
    }
  };
  return {
    s,
    f,
    rt
  };
}

function parity(s, f) {
  const before = JSON.stringify({
      s,
      f
    }),
    all = N.allStats(s, f);
  for (const l of s.services) {
    const expected = oldStats(s, f, l.id);
    assert.deepEqual(N.stats(s, f, l.id), expected);
    assert.deepEqual(all.get(l.id), expected);
  }
  assert.equal(N.stats(s, f, 'missing'), null);
  assert.equal(JSON.stringify({
    s,
    f
  }), before, 'read-only forecast views');
}
const {
  s,
  f,
  rt
} = fixture();
parity(s, f);
s.ridership.lines[s.services[0].id].satisfaction = .2;
parity(s, f); // no stale cache after in-place edits
s.economy.minute = 720;
parity(s, f);
assert(!N.configure(s, s.services[0].id, {
  fareBands: [200, 250, 300, 350, 400, 450]
}).error);
parity(s, f);
const legacy = N.fresh();
parity(legacy, {
  flows: []
});
const compact = Snapshot.capture(s, rt),
  before = JSON.stringify({
    s,
    f,
    rt
  });
assert.deepEqual(OC.analyze(compact.state, f, compact.runtime), OC.analyze(s, f, rt));
assert.deepEqual(Metrics.summary(compact.state, f), Metrics.summary(s, f));
s.operationsReview = {
  large: 'x'.repeat(100000)
};
s.log = ['x'.repeat(100000)];
assert(JSON.stringify(Snapshot.capture(s, rt)).length < JSON.stringify({
  s,
  rt
}).length / 4);
delete s.operationsReview;
s.log = [];
assert.equal(before, JSON.stringify({
  s,
  f,
  rt
}));

// A multi-line list must traverse the forecast once, independent of line count.
let visits = 0;
const measured = {
  flows: {
    [Symbol.iterator]: function*() {
      for (const flow of f.flows) {
        visits++;
        yield flow;
      }
    }
  }
};
N.allStats(s, measured);
assert.equal(visits, f.flows.length);

const clock = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.floor(m) % 60)
  .padStart(2, '0');
const view = View.create({
  REVIEW: Review,
  Q,
  currency: Currency,
  clock,
  money: Currency.format,
  num: Math.round,
  esc: v => String(v).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]))
});
s.services[0].name = '<img src=x onerror=alert(1)>';
const markup = view.content(s, '', 'all');
assert(markup.includes('&lt;img'));
assert(!markup.includes('<img'));
assert(markup.includes('尚无调整记录'));
assert.equal(view.pulse(s), '');

async function workerContracts() {
  const timers = new Map(),
    workers = [];
  let sequence = 0;
  const options = {
    timeout: 45,
    timeoutMessage: 'timeout',
    errorMessage: 'broken',
    setTimer(fn) {
      const id = ++sequence;
      timers.set(id, fn);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    createWorker() {
      const w = {
        sent: [],
        terminate() {
          this.closed = true;
        },
        postMessage(m) {
          if (m.bad) throw Error('clone');
          this.sent.push(m);
        }
      };
      workers.push(w);
      return w;
    }
  };
  const client = Client.create(options),
    a = client.request({
      value: 1
    }),
    b = client.request({
      value: 2
    }),
    w = workers[0];
  w.onmessage({
    data: {
      id: 999,
      text: 'ignored'
    }
  });
  assert.equal(client.pending, 2);
  w.onmessage({
    data: {
      id: w.sent[1].id,
      text: 'second'
    }
  });
  w.onmessage({
    data: {
      id: w.sent[0].id,
      text: 'first'
    }
  });
  assert.equal((await a).text, 'first');
  assert.equal((await b).text, 'second');
  assert.equal(timers.size, 0);
  await assert.rejects(client.request({
    bad: true
  }), /clone/);
  assert.equal(timers.size, 0);
  assert.equal(client.pending, 0);
  const e = client.request({});
  w.onmessage({
    data: {
      id: w.sent.at(-1).id,
      error: 'calculation'
    }
  });
  await assert.rejects(e, /calculation/);
  assert(client.active, 'job error keeps healthy worker');
  const c = client.request({}).catch(e => e.message),
    d = client.request({}).catch(e => e.message),
    late = w.onerror;
  [...timers.values()][0]();
  assert.equal(await c, 'timeout');
  assert.equal(await d, 'timeout');
  assert(w.closed);
  assert.equal(timers.size, 0);
  assert.equal(client.pending, 0);
  const newer = client.request({}),
    next = workers[1];
  late({
    message: 'old callback'
  });
  assert(client.active);
  next.onmessage({
    data: {
      id: next.sent[0].id,
      result: 42
    }
  });
  assert.equal((await newer).result, 42);
  const corrupt = client.request({}).catch(e => e.message);
  next.onmessageerror();
  assert.equal(await corrupt, 'broken');
  const last = client.request({}).catch(e => e.message);
  workers[2].onerror({
    message: 'crash'
  });
  assert.equal(await last, 'crash');
  const cancelled = client.request({}).catch(e => e.message);
  client.dispose();
  assert.match(await cancelled, /关闭/);
  await assert.rejects(client.request({}), /关闭/);
  assert.equal(timers.size, 0);
  const fallback = Client.create({
    ...options,
    createWorker: () => null,
    fallback: ({
      value
    }) => ({
      result: value * 2
    })
  });
  const backup = fallback.request({
    value: 7
  });
  [...timers.values()][0]();
  assert.equal((await backup).result, 14);
  assert.equal(fallback.pending, 0);
  assert.equal(timers.size, 0);
  const stopped = fallback.request({
    value: 3
  }).catch(e => e.message);
  fallback.dispose();
  assert.match(await stopped, /关闭/);
  assert.equal(timers.size, 0);
  const denied = Client.create({
    ...options,
    createWorker: () => {
      throw Error('denied');
    }
  });
  await assert.rejects(denied.request({}), /denied/);
}
workerContracts().then(() => console.log(
  'MAP38 passed: exact MAP37 statistics (local/express/cross/loop/legacy), one-pass batch, in-place mutation freshness, compact diagnostic parity, escaped views, concurrent RPC, timeout/crash/clone cleanup, stale callbacks, fallback and restart.'
  )).catch(e => {
  console.error(e);
  process.exitCode = 1;
});
