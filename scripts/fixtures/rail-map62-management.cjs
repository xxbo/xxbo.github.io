/* Frozen MAP62 fbf07978b329b2b3974eb693ebbae5230fcadd67; only module paths redirected. */
/* Save values use legacy accounting units; UI uses fixed CNY denomination; rates and costs are deliberately simplified game rules. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    R = node ? require('../../rail/engine') : root.RailSim,
    N = node ? require('../../rail/network') : root.RailNetwork,
    P = node ? require('../../rail/passengers') : root.RailPassengers;
  const Q = node ? require('../../rail/ridership') : root.RailRidership,
    BAL = node ? require('../../rail/game-balance') : root.RailBalance;
  const F = node ? require('./rail-map62-fleet.cjs') : root.RailFleet,
    U = node ? require('./rail-map62-urban-growth.cjs') : root.RailUrban,
    C = node ? require('../../rail/city') : root.RailCity,
    RV = node ? require('../../rail/operations-review') : root.RailOperationsReview;
  const Engine = node ? require('../../rail/engine-wasm') : root.RailNativeEngine;
  const Native = node ? require('../../rail/operations-wasm') : root.RailNativeOperations;
  const INITIAL = 5e9,
    CREDIT = 3e9,
    MAX_LOAN = 1e9,
    RATE = .0005,
    TERM = 30,
    TRACK = BAL.TRACK,
    STATION = BAL.STATION,
    CAR = BAL.CAR;

  function init(s) {
    Q.init(s);
    if (!s.economy) s.economy = {
      balanceVersion: BAL.VERSION,
      operatingGrant: 0,
      infrastructureRebate: 0,
      cash: INITIAL,
      loans: [],
      nextLoan: 1,
      construction: 0,
      salvage: 0,
      revenue: 0,
      operating: 0,
      interestPaid: 0,
      principalPaid: 0,
      arrears: 0,
      blocked: false,
      minute: 420,
      ledger: [{
        minute: 420,
        type: '初始资金',
        amount: INITIAL
      }]
    };
    const e = s.economy;
    if (e.balanceVersion !== BAL.VERSION) {
      const rebate = s.tracks.reduce((v, t) => v + t.km * (200e6 - TRACK), 0) + served(s).size * (
        80e6 -
        STATION) + cars(s) * (5e6 - CAR);
      e.operatingGrant = Number.isFinite(e.operatingGrant) ? e.operatingGrant : 0;
      e.infrastructureRebate = (Number.isFinite(e.infrastructureRebate) ? e.infrastructureRebate :
          0) +
        rebate;
      e.cash += rebate;
      e.balanceVersion = BAL.VERSION;
      if (rebate > 0) record(e, '建设成本调整返还', rebate);
    }
    return s;
  }

  function record(e, type, amount, minute = e.minute) {
    e.ledger.unshift({
      minute,
      type,
      amount
    });
    e.ledger = e.ledger.slice(0, 80);
  }

  function validate(s) {
    const e = s.economy,
      finite = n => Number.isFinite(n) && n >= 0;
    if (!e || !['cash', 'construction', 'salvage', 'revenue', 'operating', 'operatingGrant',
        'infrastructureRebate', 'interestPaid', 'principalPaid', 'arrears', 'minute'
      ].every(k => finite(e[k])) || e.minute < 420 || e.minute > 1e8 || !Array.isArray(e.loans) ||
      e.loans
      .length > 3 || !Number.isInteger(e.nextLoan) || typeof e.blocked !== 'boolean' || !Array
      .isArray(e
        .ledger) || e.ledger.length > 80) return false;
    let total = 0;
    for (const l of e.loans) {
      if (!Number.isInteger(l.id) || !finite(l.principal) || !finite(l.interest) || !finite(l
          .initial) || l
        .initial > MAX_LOAN || l.initial < 1e8 || l.principal > l.initial + .01 || !finite(l
          .nextDue) || !
        finite(l.installment)) return false;
      total += l.principal;
    }
    return total <= CREDIT + .01;
  }
  const served = s => new Set(s.services.flatMap(l => l.stops)),
    cars = s => s.services.reduce((v, l) => v + l.fleet * l.cars, 0);

  function quote(before, after) {
    const oldTracks = new Set(before.tracks.map(t => t.id)),
      newTracks = new Set(after.tracks.map(t => t.id)),
      oldStations = served(before),
      newStations = served(after),
      addedKm = after.tracks.filter(t => !oldTracks.has(t.id)).reduce((v, t) => v + t.km, 0),
      removedKm = before.tracks.filter(t => !newTracks.has(t.id)).reduce((v, t) => v + t.km, 0),
      addedStations = [...newStations].filter(id => !oldStations.has(id)).length,
      removedStations = [...oldStations].filter(id => !newStations.has(id)).length,
      deltaCars = cars(after) - cars(before),
      deltaVehicle = F.value(after) - F.value(before),
      deltaFacility = U.facilitiesValue(after) - U.facilitiesValue(before),
      construction = addedKm * TRACK + addedStations * STATION + Math.max(0, deltaVehicle) + Math
      .max(0,
        deltaFacility),
      salvage = removedKm * TRACK * .2 + removedStations * STATION * .2 + Math.max(0, -
        deltaVehicle) * .5 +
      Math.max(0, -deltaFacility) * .2;
    return {
      construction,
      salvage,
      net: construction - salvage,
      addedKm,
      addedStations,
      deltaCars
    };
  }

  function preview(s, operation) {
    const c = R.clone(s),
      result = operation(c);
    if (result?.error) return result;
    return {
      ...quote(s, c),
      result,
      after: c
    };
  }

  function change(s, operation) {
    init(s);
    const plan = preview(s, operation);
    if (plan.error) return plan;
    const e = s.economy;
    if (plan.net > e.cash + .01) return {
      error: '余额不足。当前建设需要 ' + (plan.net * .05 / 1e4).toFixed(1) + ' 万元人民币，请缩短线路或申请贷款。'
    };
    const c = plan.after;
    c.economy.cash = Math.max(0, e.cash - plan.net);
    c.economy.construction += plan.construction;
    c.economy.salvage += plan.salvage;
    record(c.economy, plan.net >= 0 ? '建设与车辆投入' : '资产回收', -plan.net);
    Object.assign(s, c);
    Q.sync(s, s.economy.minute);
    settle(s);
    return {
      ...plan.result,
      quote: plan
    };
  }

  function available(s) {
    init(s);
    return Native.credit(s, 0).available;
  }

  const CREDIT_ERRORS = [null,
    '贷款额度不足：最多 3 笔，未偿本金合计不超过 1.5 亿元人民币，每笔 500 万—5000 万元。',
    '贷款不存在。', '余额不足以结清这笔贷款。'
  ];

  function borrow(s, amount) {
    init(s);
    const result = Native.credit(s, 1, amount);
    return result.error ? {
      error: CREDIT_ERRORS[result.error]
    } : {};
  }

  function repay(s, id) {
    init(s);
    const result = Native.credit(s, 2, 0, s.economy.loans.findIndex(l => l.id === id));
    return result.error ? {
      error: CREDIT_ERRORS[result.error]
    } : {};
  }

  function settle(s) {
    return Native.accounts(s, {
      minute: s.economy.minute
    }, 1).running;
  }

  function validInterval(minutes, limit = 1440) {
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > limit) throw Error(
      'Invalid management interval');
  }

  function advance(s, rt, minutes) {
    validInterval(minutes);
    init(s);
    return advanceInterval(s, rt, minutes);
  }

  // Yield between complete legacy UI quanta, preserving loan-split and callback order.
  function advanceBudget(s, rt, minutes, options = {}) {
    validInterval(minutes, 1e8);
    const now = options.now || (() => performance.now()),
      budget = options.budget ?? 6,
      maxSteps = options.maxSteps ?? 100;
    if (!Number.isFinite(budget) || budget < 0 || !Number.isInteger(maxSteps) ||
      maxSteps < 1 || maxSteps > 10000) throw Error('Invalid simulation budget');
    const start = now();
    init(s);
    const trackFixed = s.tracks.reduce((value, track) => value + track.km * 2200, 0);
    let remaining = minutes,
      steps = 0,
      running = true,
      reason = 'complete';
    while (remaining > 1e-8) {
      if (options.shouldYield?.()) {
        reason = 'interrupted';
        break;
      }
      const dt = Math.min(.1, remaining);
      running = advanceInterval(s, rt, dt, trackFixed);
      remaining -= dt;
      if (!running) {
        reason = 'blocked';
        break;
      }
      steps++;
      if (remaining <= 1e-8) break;
      if (steps >= maxSteps) {
        reason = 'steps';
        break;
      }
      if (now() - start >= budget) {
        reason = 'time';
        break;
      }
      if(!options.shouldYield&&(!options.now||options.nativeLoop===true)) {
        const result=P.continueRun(rt,s,remaining,{maxSteps:maxSteps-steps,budget:Math.max(0,budget-(now()-start)),now});
        if(result?.steps) {
          remaining=result.remaining;steps+=result.steps;running=result.running;
          if(!running){reason='blocked';break;}
          if(remaining<=1e-8)break;
          if(steps>=maxSteps){reason='steps';break;}
          if(now()-start>=budget){reason='time';break;}
        }
      }
    }
    return {running, remaining, steps, consumed: minutes - remaining, reason};
  }

  function* interval(s, rt, minutes, trackFixed = s.tracks.reduce(
    (value, track) => value + track.km * 2200, 0)) {
    let frame = Engine.begin(s, rt, minutes);
    if (!frame.running) return false;
    while (frame.left > 1e-9) {
      const {
        dt,
        target,
        left
      } = frame;
      const job = {
        world: s,
        left,
        dt,
        trackFixed,
        beforeRevenue: rt.revenue,
        beforeExpense: rt.vehicleExpense
      };
      yield [rt,s,dt,target,frame.carry,frame.interval,job];
      if (dt > 1e-9) frame = job.result;
      else {
        const active = s.services.reduce((v, l) => v + (l.fleetManaged ? F.planned(l, rt.minute) :
          l.fleet), 0);
        const owned = s.depot ? Object.values(s.depot.stock).reduce((a, b) => a + b, 0) : active;
        frame = Native.accounts(s, rt, 2, left, dt, 0, 0, trackFixed, U.upkeep(s), active, owned,
          Q.financeFrame(s, rt));
      }
      if (s.urban) U.advance(s, C.create(s.region), rt.minute);
      if (s.operationsReview) RV.sample(s, rt);
      if (!frame.running) return false;
    }
    return true;
  }
  function advanceInterval(...args) {
    const generator=interval(...args);let step=generator.next();
    while(!step.done){P.advanceTick(...step.value);step=generator.next();}
    return step.value;
  }
  async function advanceIntervalAsync(...args) {
    const generator=interval(...args);let step=generator.next();
    while(!step.done){await P.advanceTickAsync(...step.value);step=generator.next();}
    return step.value;
  }
  const pending=new WeakMap(),errors=new WeakMap();
  function whenIdle(rt) {return pending.get(rt)||Promise.resolve();}
  function advanceBudgetAsync(s,rt,minutes,options={}) {
    const task=whenIdle(rt).then(async()=>{
      validInterval(minutes,1e8);init(s);
      const now=options.now||(()=>performance.now()),start=now(),budget=options.budget??6,max=options.maxSteps??100;
      if(!Number.isFinite(budget)||budget<0||!Number.isInteger(max)||max<1||max>10000)throw Error('Invalid simulation budget');
      const trackFixed=s.tracks.reduce((n,t)=>n+t.km*2200,0);
      let remaining=minutes,steps=0,running=true,reason='complete';
      while(remaining>1e-8&&steps<max) {
        if(options.shouldYield?.()){reason='interrupted';break;}
        const batch=await P.continueAsync(rt,s,remaining,{maxSteps:max-steps,budget:Math.max(0,budget-(now()-start))});
        if(batch?.steps) {remaining=batch.remaining;steps+=batch.steps;running=batch.running;}
        else {
          const dt=Math.min(.1,remaining);
          running=await advanceIntervalAsync(s,rt,dt,trackFixed);
          remaining-=dt;if(running)steps++;
        }
        if(!running){reason='blocked';break;}
        if(remaining<=1e-8)break;
        if(steps>=max){reason='steps';break;}
        if(now()-start>=budget){reason='time';break;}
      }
      return {running,remaining,steps,consumed:minutes-remaining,reason};
    });
    const settled=task.then(()=>{},error=>{errors.set(rt,error);});pending.set(rt,settled);
    settled.finally(()=>{if(pending.get(rt)===settled)pending.delete(rt);});
    return task;
  }
  function signature(s) {
    return 'transit-city-v19|' + s.region + '|' + JSON.stringify([s.routeModel, s.services.map(
      l => [l.id, l
        .stops, l.trackIds, l.headway, l.fleet, l.cars, l.open, l.close, l.fareBands, l
        .patterns, l
        .loopDirection, l.stockSpec, l.fleetManaged, l.dispatch
      ]), s.depot, s.urban ? [s.urban.version, s.urban.revision] : null, s.tracks.map(t => [
      t.id, t.km,
      t.bends, t.curve
    ])]);
  }
  const api = {
    init,
    validate,
    quote,
    preview,
    change,
    available,
    borrow,
    repay,
    settle,
    advance,
    advanceBudget,advanceBudgetAsync,whenIdle,
    isBusy:rt=>pending.has(rt),lastError:rt=>errors.get(rt),
    signature,
    INITIAL,
    CREDIT,
    MAX_LOAN,
    RATE,
    TERM,
    TRACK,
    STATION,
    CAR
  };
  if (node) module.exports = api;
  else root.RailManagement = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
