/* Native feedback/accounts/shared clock transport. Objects remain compatible with existing saves. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./rail-map51-routing-wasm.cjs') : root.RailRouting;
  const X = node ? require('./rail-map51-service-plan.cjs') : root.RailServicePlan;
  const F = node ? require('./rail-map51-fleet.cjs') : root.RailFleet;
  const BAL = node ? require('../../rail/game-balance') : root.RailBalance;
  const SCORES = ['crowding', 'waiting', 'speed', 'coverage', 'fare', 'reliability', 'hours'];
  const FEEDBACK = ['serviceDays', 'awareness', 'trust', 'attempted', 'lost', 'wait', 'boarded'];
  const ECONOMY = ['cash', 'revenue', 'operatingGrant', 'operating', 'interestPaid',
    'principalPaid', 'arrears', 'minute', 'blocked'
  ];
  const run = a => Core.kernel('operations_run', a);

  function feedbackFrame(s, rt, minutes, step, only = null) {
    const q = s.ridership,
      ls = s.baseLines || s.services;
    const U = node ? require('../../rail/urban-growth') : root.RailUrban;
    const ids = new Map(ls.map((l, i) => [l.id, i]));
    const active = new Set(rt.trains.map(t => t.parentLine || t.service));
    if (step)
      for (const l of (rt.plan || s).services)
        for (const dir of X.directions(l)) {
          const d = rt.departures[l.id + '|' + dir];
          if (d?.lastRun !== undefined && rt.minute - d.lastRun <= 1.5 * (d.headway || l.headway))
            for (const id of new Set([l.parentLine || l.id, ...(l.fareLines || [])])) active.add(
              id);
        }
    const out = [1, 0, rt.minute, minutes, +step, +!!(q.model === 22 || only), s.nodes.length];
    for (const n of s.nodes) out.push(n.x, n.y);
    const fs = s.urban?.facilities || [];
    out.push(fs.length);
    for (const f of fs) {
      const t = U.TYPES[f.kind];
      out.push(f.x, f.y, t.visits[f.level - 1] + t.jobs[f.level - 1]);
    }
    const km = new Map(s.tracks.map(t => [t.id, t.km]));
    out.push(ls.length);
    for (const l of ls) {
      const r = q.lines[l.id];
      const length = l.trackIds.reduce((v, id) => v + (km.get(id) || 0), 0);
      const direct = l.stops[0] === l.stops.at(-1) ? length : X.distance(s.nodes[l.stops[0]], s
        .nodes[l.stops.at(-1)]);
      const fareKm = Math.min(10, Math.max(1, length));
      out.push(l.open, l.close, +active.has(l.id), +(!l.fleetManaged || F.planned(l, rt.minute) >
          0),
        length, direct, X.fare(l, fareKm), X.fare({
          ...l,
          fareBands: undefined
        }, fareKm), l.stops.length, ...l.stops);
      for (const k of FEEDBACK) out.push(Number(r[k]));
      out.push(r.satisfaction ?? .7, r.feedbackMinute ?? 0, +(r.feedbackMinute == null));
    }
    // Expand once for all lines, rather than once per evaluated line.
    const runs = X.expand(s, rt.minute).services;
    out.push(runs.length);
    for (const l of runs) out.push(ids.get(l.parentLine || l.id) ?? ls.length, X.headway(s, l), X
      .duration(s, l));
    out.push(rt.trains.length);
    for (const t of rt.trains) out.push(ids.get(t.parentLine || t.service) ?? ls.length, t
      .onboard, t.capacity);
    return {input:out,context:{s,rt,ls,ids,step,only}};
  }
  function feedback(s,rt,minutes,step,only=null) {
    const frame=feedbackFrame(s,rt,minutes,step,only);
    return projectFeedback(frame,run(frame.input));
  }
  function projectFeedback(frame,data) {
    const {s,rt,ls,step,only}=frame.context,q=s.ridership;
    const results=new Map();

    let at = 2;
    for (const l of ls) {
      const r = q.lines[l.id];
      if (step)
        for (let k = 0; k < FEEDBACK.length; k++) r[FEEDBACK[k]] = data[at + k];
      at += 7;
      const update = data[at++];
      if (!update) continue;
      const scores = Object.fromEntries(SCORES.map(k => [k, data[at++]]));
      const [score, headway, load, wait, loss, speed, covered, total, satisfaction] = data.slice(
        at, at + 9);
      at += 9;
      results.set(l.id, {
        scores,
        score,
        headway,
        load,
        wait,
        loss,
        speed,
        covered,
        total
      });
      if (!only) {
        r.scores = scores;
        r.observations = {
          load,
          wait,
          loss,
          speed,
          covered,
          total
        };
        r.satisfaction = satisfaction;
        r.feedbackMinute = rt.minute;
      }
    }
    return only ? results.get(only.id) : results;
  }

  function accounts(s, rt, op, left = 0, dt = 0, earned = 0, vehicle = 0, track = 0, upkeep = 0,
    active = 0, owned = 0, finance = null) {
    const e = s.economy;
    const input = [1, op, rt.minute, left, dt, earned, vehicle, track, upkeep, active, owned, BAL
      .OPERATING_FACTOR, BAL.GRANT_RATE, rt.demandCarry || 0
    ];
    for (const k of ECONOMY) input.push(Number(e[k]));
    input.push(e.loans.length);
    for (const l of e.loans) input.push(l.principal, l.interest, l.installment, l.nextDue);
    if (finance) input.push(finance.length, ...finance.input);
    else input.push(0);
    const data = run(input);
    return projectAccounts(s, data, op, left, vehicle, finance);
  }

  function projectAccounts(s, data, op, left = 0, vehicle = 0, finance = null) {
    const e = s.economy;
    let at = 8;
    for (const k of ECONOMY) e[k] = k === 'blocked' ? !!data[at++] : data[at++];
    const loans = [];
    const n = data[at++];
    for (let i = 0; i < n; i++) {
      const index = data[at++];
      const l = index < 0 ? {
        id: e.nextLoan,
        initial: left
      } : e.loans[index];
      l.principal = data[at++];
      l.interest = data[at++];
      l.installment = data[at++];
      l.nextDue = data[at++];
      loans.push(l);
    }
    e.loans = loans;
    const payments = data[at++],
      paid = data.slice(at, at + payments);
    at += payments;
    const size = data[at++];
    if (size) {
      finance.apply(data.subarray(at, at + size));
      at += size;
    }
    const [error, available, amount, nextId] = data.subarray(at, at + 4);
    if (op === 6 && !error && vehicle) {
      e.nextLoan = nextId;
      e.ledger.unshift({
        minute: e.minute,
        type: vehicle === 1 ? '贷款到账' : '提前结清贷款',
        amount
      });
    }
    for (const bill of paid) e.ledger.unshift({
      minute: e.minute,
      type: '每日偿还贷款本息',
      amount: -bill
    });
    if (payments || (op === 6 && !error && vehicle)) e.ledger = e.ledger.slice(0, 80);
    return {
      dt: data[1],
      left: data[2],
      target: data[3],
      cost: data[4],
      fixed: data[5],
      carry: data[6],
      interval: data[7],
      running: !e.blocked,
      error,
      available
    };
  }

  function credit(s, action, amount = 0, index = -1) {
    return accounts(s, {
      minute: s.economy.minute
    }, 6, typeof amount === 'number' ? amount : NaN, index, s.economy.nextLoan, action);
  }

  function clock(minute, minutes, carry) {
    return run([1, 4, minute, minutes, carry]);
  }

  function allocation(current, cost, fixed, rows) {
    const a = [1, 5, cost, fixed, Number(current), rows.length];
    for (const [previous, weight] of rows) a.push(Number(previous), weight);
    return run(a);
  }
  const api = {
    feedback,
    feedbackFrame,
    projectFeedback,
    projectAccounts,
    ECONOMY,
    accounts,
    clock,
    allocation,
    credit
  };
  if (node) module.exports = api;
  else root.RailNativeOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
