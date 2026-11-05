/* Frozen MAP39 route search, for exact memory-refactor parity tests only. */
const {
  fare,
  TRANSFER
} = require('../../rail/service-plan');

function paths(s, adj, origin, value = .045, firstKey = null) {
  const lines = new Map(s.services.map(l => [l.id, l])),
    result = [],
    heap = [],
    best = new Map();

  function push(p) {
    heap.push(p);
    let i = heap.length - 1;
    while (i) {
      let j = (i - 1) >> 1;
      if (heap[j].cost <= p.cost) break;
      heap[i] = heap[j];
      i = j;
    }
    heap[i] = p;
  }

  function pop() {
    const first = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let j = i * 2 + 1;
        if (j + 1 < heap.length && heap[j + 1].cost < heap[j].cost) j++;
        if (last.cost <= heap[j].cost) break;
        heap[i] = heap[j];
        i = j;
      }
      heap[i] = last;
    }
    return first;
  }
  const first = {
    node: origin,
    service: '',
    dir: 0,
    lastLine: '',
    fareKm: 0,
    board: origin,
    cost: 0,
    minutes: 0,
    fare: 0,
    km: 0,
    edges: [],
    transfers: 0,
    fares: {}
  };
  first.key = origin + '|';
  best.set(first.key, 0);
  push(first);
  while (heap.length) {
    const cur = pop();
    if (cur.cost > best.get(cur.key) + 1e-8) continue;
    if (!result[cur.node] || cur.cost < result[cur.node].cost) result[cur.node] = cur;
    for (const e of adj[cur.node]) {
      if (!cur.edges.length && firstKey && e.service + '|' + e.dir !== firstKey) continue;
      if (cur.edges.length > 120) continue;
      const change = e.service !== cur.service || e.dir !== cur.dir,
        transfer = change && !!cur.service,
        extra = change ? e.headway / 2 + (transfer ? TRANSFER : 0) : 0;
      let fee = 0,
        lastLine = cur.lastLine,
        fareKm = cur.fareKm,
        board = cur.board,
        fares = {
          ...cur.fares
        };
      for (const part of e.parts) {
        if (part.line !== lastLine) {
          lastLine = part.line;
          fareKm = 0;
          board = cur.node;
        }
        const amount = fare(lines.get(part.line), fareKm + part.km) - fare(lines.get(part.line), fareKm);
        fareKm += part.km;
        fee += amount;
        fares[part.line] = (fares[part.line] || 0) + amount;
      }
      const p = {
        node: e.to,
        service: e.service,
        dir: e.dir,
        lastLine,
        fareKm,
        board,
        cost: cur.cost + e.minutes + extra + fee * value,
        minutes: cur.minutes + e.minutes + extra,
        fare: cur.fare + fee,
        km: cur.km + e.km,
        edges: [...cur.edges, e],
        transfers: cur.transfers + (transfer ? 1 : 0),
        fares
      };
      p.key = [e.to, e.service, e.dir, lastLine, board].join('|');
      if (p.cost < (best.get(p.key) ?? Infinity) - 1e-8) {
        best.set(p.key, p.cost);
        push(p);
      }
    }
  }
  return result;
}

module.exports = paths;
