/* Deterministic presentation fixture; never loaded by the game. */
const N = require('../../rail/network'),
  M = require('../../rail/management'),
  F = require('../../rail/fleet'),
  Q = require('../../rail/ridership'),
  X = require('../../rail/service-plan'),
  V = require('../../rail/view'),
  OC = require('../../rail/operations-center'),
  Currency = require('../../rail/currency');
const format = {
  num: n => Math.round(n).toLocaleString('zh-CN'),
  money: Currency.format,
  clock: m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.floor(m) % 60).padStart(
    2, '0'),
  esc: v => String(v).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]))
};

function fixture(empty = false) {
  const s = M.init(N.upgrade(N.emptyWorld('gba'))),
    p = (x, y) => ({
      x,
      y,
      nameSeed: .25
    });
  if (!empty) {
    N.addLine(s, [p(600, 500), p(640, 500), p(680, 500), p(720, 500), p(760, 500), p(800, 500)], {
      stockSpec: '6B'
    });
    N.addLine(s, [s.services[0].stops[2], p(680, 540), p(720, 540), p(760, 540)], {
      stockSpec: '6B'
    });
    N.addLine(s, [p(850, 500), p(890, 500), p(890, 540), p(850, 500)], {
      stockSpec: '6B'
    });
    F.purchase(s, '6B', 40);
    for (const l of s.services) N.configure(s, l.id, {
      dispatch: {
        mode: 'manual',
        manual: 6,
        offPeak: 4,
        peak: 6
      }
    });
    const l = s.services[0],
      other = s.services[1];
    const r = N.configure(s, l.id, {
      patterns: [{
        kind: 'local',
        from: 0,
        to: 5,
        fleet: 2,
        headway: 6
      }, {
        kind: 'express',
        from: 0,
        to: 5,
        calls: [l.stops[0], l.stops[5]],
        fleet: 2,
        headway: 6
      }, {
        kind: 'cross',
        from: 0,
        to: 2,
        target: other.id,
        targetEnd: 3,
        fleet: 2,
        headway: 6
      }]
    });
    if (r.error) throw Error(r.error);
    l.name = '机场 <快线> & 联络';
    s.nodes[0].name = '住区 <A>';
    M.borrow(s, 1e8);
  }
  Q.enableSatisfaction(s);
  const flows = [],
    graph = X.network(s);
  for (const from of s.nodes.map(n => n.id))
    for (const path of X.paths(s, graph, from))
      if (path?.edges.length) flows.push({
        from,
        to: path.node,
        trips: 30.25,
        path
      });
  const f = {
    flows,
    population: 10000,
    catchment: {
      covered: 6000,
      stations: {}
    },
    lineConnections: {}
  };
  for (const l of s.services) f.lineConnections[l.id] = {
    demand: 100,
    purposes: {
      work: 60,
      shopping: 30,
      leisure: 10
    },
    people: 500,
    jobs: 200,
    reachableJobs: 300,
    minutes: 15,
    sharedShare: .3,
    transferShare: .2,
    hub: 40
  };
  const rt = {
    minute: 480,
    trains: [],
    queues: {},
    outside: {},
    transfers: []
  };
  const rows = OC.analyze(s, f, rt),
    metrics = require('../../rail/metrics').summary(s, f);
  return {
    s,
    f,
    rt,
    rows,
    metrics
  };
}
module.exports = {
  fixture,
  format,
  N,
  M,
  F,
  Q,
  X,
  V,
  OC,
  Currency
};
