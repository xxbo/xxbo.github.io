/* Frozen legacy search oracle. Never staged in the public site. */
  // Binary min-heap keeps metropolitan path searches responsive.
  function pushHeap(h, item) {
    let i = h.length;
    h.push(item);
    while (i) {
      const p = (i - 1) >> 1;
      if (h[p].p.cost <= item.p.cost) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = item;
  }

  function popHeap(h) {
    const top = h[0],
      last = h.pop();
    if (h.length) {
      let i = 0;
      while (i * 2 + 1 < h.length) {
        let c = i * 2 + 1;
        if (c + 1 < h.length && h[c + 1].p.cost < h[c].p.cost) c++;
        if (h[c].p.cost >= last.p.cost) break;
        h[i] = h[c];
        i = c;
      }
      h[i] = last;
    }
    return top;
  }

  function paths(s, adj, origin, value = .045) {
    
    const start = origin + '||0|0',
      best = new Map([
        [start, {
          node: origin,
          service: '',
          paid: 0,
          discounted: 0,
          cost: 0,
          minutes: 0,
          fare: 0,
          km: 0,
          edges: [],
          transfers: 0
        }]
      ]),
      done = new Set(),
      result = [],
      heap = [];
    pushHeap(heap, {
      id: start,
      p: best.get(start)
    });
    while (heap.length) {
      const item = popHeap(heap),
        cur = item.p,
        k = item.id;
      if (done.has(k) || best.get(k) !== cur) continue;
      done.add(k);
      if (!result[cur.node] || cur.cost < result[cur.node].cost) result[cur.node] = cur;
      for (const e of adj[cur.node]) {
        const change = cur.service !== e.service,
          transfer = change && !!cur.service,
          wait = change ? e.headway / 2 : 0,
          extra = wait + (transfer ? 4 : 0) + e.penalty;
        const bit = 1 << s.companies.findIndex(c => c.id === e.owner),
          paid = cur.paid | bit;
        let fee = (cur.paid & bit) ? 0 : e.fare,
          discounted = cur.discounted;
        const prior = e.through ? cur.edges.filter(v => v.service === e.service).reduce((v, x) => v | (1 <<
          s.companies.findIndex(c => c.id === x.owner)), 0) : 0;
        if (e.through && prior && (prior & bit) === 0) {
          const eligible = (prior | bit) & ~discounted;
          for (let ci = 0; ci < s.companies.length; ci++)
            if (eligible & (1 << ci)) fee -= s.companies[ci].fare * .15;
          discounted |= prior | bit;
        }
        const p = {
          node: e.to,
          service: e.service,
          paid,
          discounted,
          cost: cur.cost + e.minutes + extra + fee * value,
          minutes: cur.minutes + e.minutes + extra,
          fare: cur.fare + fee,
          km: cur.km + e.km,
          edges: cur.edges.concat(e),
          transfers: cur.transfers + (transfer ? 1 : 0)
        };
        const nk = e.to + '|' + e.service + '|' + paid + '|' + discounted;
        if (!best.has(nk) || p.cost < best.get(nk).cost - .000001) {
          best.set(nk, p);
          done.delete(nk);
          pushHeap(heap, {
            id: nk,
            p
          });
        }
      }
    }
    return result;
  }


module.exports = paths;
