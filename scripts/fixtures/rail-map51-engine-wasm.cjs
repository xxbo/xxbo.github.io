/* Combined passenger/finance transaction. JS retains save-compatible object identities. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./rail-map51-routing-wasm.cjs') : root.RailRouting;
  const Native = node ? require('./rail-map51-operations-wasm.cjs') : root.RailNativeOperations;
  const Q = node ? require('./rail-map51-ridership.cjs') : root.RailRidership;
  const F = node ? require('./rail-map51-fleet.cjs') : root.RailFleet;
  const U = node ? require('../../rail/urban-growth') : root.RailUrban;
  const BAL = node ? require('../../rail/game-balance') : root.RailBalance;
  const states = new WeakMap();
  const LOAN = ['principal', 'interest', 'installment', 'nextDue'];

  function snapshot(e, previous) {
    const n = 10 + e.loans.length * 4;
    const values = previous?.length === n ? previous : new Float64Array(n);
    let at = 0;
    for (const k of Native.ECONOMY) values[at++] = Number(e[k]);
    values[at++] = e.loans.length;
    for (const l of e.loans)
      for (const k of LOAN) values[at++] = l[k];
    return values;
  }

  function matches(values, e) {
    if (values?.length !== 10 + e.loans.length * 4) return false;
    let at = 0;
    for (const k of Native.ECONOMY)
      if (!Object.is(values[at++], Number(e[k]))) return false;
    if (values[at++] !== e.loans.length) return false;
    for (const l of e.loans)
      for (const k of LOAN)
        if (!Object.is(values[at++], l[k])) return false;
    return true;
  }

  function state(s) {
    let c = states.get(s.economy);
    if (!c) {
      c = {
        token: Core.allocateToken()
      };
      states.set(s.economy, c);
    }
    return c;
  }

  function begin(s, rt, minutes) {
    const c = state(s),
      p = c.prepared;
    if (minutes >= .1 && p && p.minute === rt.minute && p.carry === (rt.demandCarry || 0) &&
      Core.engineToken() === c.token && matches(c.snapshot, s.economy)) {
      return {
        ...p.frame,
        left: minutes
      };
    }
    return Native.accounts(s, rt, 3, minutes);
  }

  function encode(codec, rt, job, named, full) {
    const s = job.world,
      c = state(s);
    const rows = Q.financeLayout(s);
    const load = full || Core.engineToken() !== c.token || !matches(c.snapshot, s.economy) ||
      c.codec !== codec || c.rows !== rows || c.q !== s.ridership;
    const active = s.services.reduce((v, l) => v + (l.fleetManaged ? F.planned(l, rt.minute) : l
      .fleet), 0);
    const owned = s.depot ? Object.values(s.depot.stock).reduce((a, b) => a + b, 0) : active;
    const day = s.ridership?.current;
    const operating = day?.number === Q.day(rt.minute) ? Number(day.operating) : 0;
    const out = [1, c.token, +load, rt.minute, job.left, job.dt, rt.demandCarry || 0,
      job.beforeRevenue, job.beforeExpense, job.trackFixed, U.upkeep(s), active, owned,
      BAL.OPERATING_FACTOR, BAL.GRANT_RATE, operating
    ];
    if (load) {
      out.push(...snapshot(s.economy), +!!rows, rows?.length || 0);
      for (const [id, weight] of rows || []) out.push(named(codec, id), weight);
    }
    job.native = {
      c,
      codec,
      rows,
      q: s.ridership
    };
    return out;
  }

  function continuation(codec,rt,job,previous) {
    const s=job.world,c=state(s);
    if(!previous||Core.engineToken()!==c.token||!matches(c.snapshot,s.economy)||c.codec!==codec||
      c.rows!==Q.financeLayout(s)||c.q!==s.ridership)return null;
    const frame=previous.slice(0,16);frame[2]=0;frame[6]=rt.demandCarry||0;
    const day=s.ridership?.current;
    frame[15]=day?.number===Q.day(rt.minute)?Number(day.operating):0;
    return frame;
  }
  function project(rt, job, data) {
    const s = job.world,
      {
        c,
        codec,
        rows,
        q
      } = job.native;
    job.result = Native.projectAccounts(s, data, 2, job.left, 0, rows ? {
      apply: values => Q.nativeFinanceApply(s, rt, rows, values)
    } : null);
    c.snapshot = snapshot(s.economy, c.snapshot);
    c.codec = codec;
    c.rows = rows;
    c.q = q;
    const p = data.length - 4;
    c.prepared = job.result.running ? {
      minute: rt.minute,
      carry: rt.demandCarry || 0,
      frame: {
        dt: data[p],
        target: data[p + 1],
        carry: data[p + 2],
        interval: data[p + 3],
        running: true
      }
    } : null;
  }
  const api = {
    begin,continuation,
    encode,
    project
  };
  if (node) module.exports = api;
  else root.RailNativeEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
