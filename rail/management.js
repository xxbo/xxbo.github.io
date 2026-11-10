/* Save values use legacy accounting units; UI uses fixed CNY denomination; rates and costs are deliberately simplified game rules. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports,
    R = node ? require('./engine') : root.RailSim,
    N = node ? require('./network') : root.RailNetwork,
    P = node ? require('./passengers') : root.RailPassengers;
  const Q = node ? require('./ridership') : root.RailRidership,
    BAL = node ? require('./game-balance') : root.RailBalance;
  const F = node ? require('./fleet') : root.RailFleet,
    U = node ? require('./urban-growth') : root.RailUrban,
    C = node ? require('./city') : root.RailCity,
    RV = node ? require('./operations-review') : root.RailOperationsReview;
  const Engine = node ? require('./engine-wasm') : root.RailNativeEngine;
  const Native = node ? require('./operations-wasm') : root.RailNativeOperations;
  const INITIAL = 5e9,
    CREDIT = 3e9,
    MAX_LOAN = 1e9,
    RATE = .0005,
    TERM = 30,
    TRACK = BAL.TRACK,
    STATION = BAL.STATION,
    CAR = BAL.CAR;

  const Assets = node ? require('./assets-wasm') : root.RailAssets;
  function init(s) {
    Q.init(s);
    if(!s.economy || s.economy.balanceVersion!==BAL.VERSION)Assets.mutate(s,'init');
    return s;
  }
  const validate = s => Assets.query(s,'validateEconomy');
  const quote = (before,after) => Assets.run(before,'quote',{}, {after:Assets.snapshot(after)}).result;

  // A descriptor lets the native core edit, validate, quote and pay in one call.
  const command = (kind,op,args={}) => ({kind,op,args});
  function plan(s,operation,commit) {
    if(typeof operation!=='function')return Assets.transaction(s,operation,commit);
    const c=R.clone(s),result=operation(c);
    if(result?.error)return result;
    return Assets.transaction(s,null,commit,c,result);
  }
  const preview = (s,operation) => plan(s,operation,false);
  function change(s,operation) {
    init(s);
    const p=plan(s,operation,true);
    if(p.error)return p;
    const c=p.after;
    Object.assign(s,c);Q.sync(s,s.economy.minute);settle(s);
    return {...p.result,quote:p};
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
    command,
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
