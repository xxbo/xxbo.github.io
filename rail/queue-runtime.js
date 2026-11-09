/* Persistent native queues. JS restores identities and projects ordered events into existing views. */
(function(root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Core = node ? require('./routing-wasm') : root.RailRouting;
  const Engine = node ? require('./engine-wasm') : root.RailNativeEngine;
  const SIM = node ? require('./simulation-wasm') : root.RailSimulation;
  const Native = node ? require('./operations-wasm') : root.RailNativeOperations;
  const Prepare = node ? require('./preparation-wasm') : root.RailPreparation;
  const R = node ? require('./engine') : root.RailSim;
  const Q = node ? require('./ridership') : root.RailRidership;
  const X = node ? require('./service-plan') : root.RailServicePlan;
  const counters = ['generated', 'boarded', 'alighted', 'completed', 'cancelled', 'rejected',
    'revenue', 'vehicleExpense'
  ];
  const kinds = ['attempt', 'enter', 'board', 'alight', 'reject', 'complete'];
  const states = new WeakMap(),
    identities = new WeakMap();
  const nativeViews=new WeakSet(),materialized=new WeakSet(),views=new WeakMap();
  let serial = 0,
    trainSerial = 0;
  const uid = t => {
    if (!identities.has(t)) identities.set(t, ++trainSerial);
    return identities.get(t);
  };
  const intern = (m, names, id) => {
    if (!m.has(id)) {
      m.set(id, names.length);
      names.push(id);
    }
    return m.get(id);
  };

  function cache(rt, s) {
    let c = states.get(rt);
    if (!c || c.plan !== s || c.defs !== rt.defs) {
      c = {
        token: Core.allocateToken(),
        plan: s,
        defs: rt.defs,
        names: [],
        ids: new Map(),
        purposes: ['work', 'shopping', 'leisure'],
        purposeIds: new Map([
          ['work', 0],
          ['shopping', 1],
          ['leisure', 2]
        ]),
        sent: 0,
        seen: new WeakSet(),
        trains: new Map(),
        limitIds: new Set(),
        fallbackLimits: new Map()
      };
      states.set(rt, c);
    }
    c.sparse=nativeViews.has(rt);
    return c;
  }

  function named(c, id) {
    return intern(c.ids, c.names, id);
  }

  function token(text) {
    const a = text.split(':');
    return [+a[0], +a[1], a.length > 2 ? +a[2] : -1];
  }

  function tokens(out, values, since, prefix) {
    const rows = Object.entries(values);
    out.push(rows.length);
    for (const [t, n] of rows) {
      out.push(...token(t), n);
      if (since) out.push(since[prefix + '#' + t] ?? NaN);
    }
  }

  function definition(c,j,s,out,runs=new Map(s.services.map(l=>[l.id,l]))) {
      const byline = Object.entries(j.byLine),
        valid = j.legs.map(e => {
          const l = runs.get(e.service);
          if (!l || !X.directions(l).includes(e.dir)) return false;
          const calls = l.callStops || l.stops;
          return calls.includes(e.from) && calls.includes(e.to) && (l.stops[0] === l.stops.at(-
            1) || (l.stops.indexOf(e.to) - l.stops.indexOf(e.from)) * e.dir > 0);
        });
      for (let k = valid.length - 2; k >= 0; k--) valid[k] = valid[k] && valid[k + 1];
      out.push(j.id, j.fare, intern(c.purposeIds, c.purposes, j.purpose), byline.length);
      for (const [id, n] of byline) out.push(named(c, id), n);
      const ids = j.lineIds || [];
      out.push(ids.length, ...ids.map(id => named(c, id)));
      out.push(j.legs.length);
      j.legs.forEach((e, k) => {
        out.push(named(c, e.service), e.dir, e.from, e.to, +valid[k]);
        c.limitIds.add(e.from);
      });
  }
  function defs(c,rt,s,out) {
    out.push(rt.defs.length-c.sent);
    const runs=new Map(s.services.map(l=>[l.id,l]));
    for(let i=c.sent;i<rt.defs.length;i++) definition(c,rt.defs[i],s,out,runs);
    c.sent=rt.defs.length;
  }

  function fullState(c, rt, out) {
    out.push(...counters.map(k => rt[k] ?? 0));
    for (const [value, kind] of [
        [rt.purposeCompleted, 'purpose'],
        [rt.lineRevenue, 'line'],
        [rt.lineBoarded, 'line']
      ]) {
      const rows = Object.entries(value || {});
      out.push(rows.length);
      for (const [k, n] of rows) out.push(kind === 'purpose' ? intern(c.purposeIds, c.purposes,
        k) : named(c, k), n);
    }
    const occ = Object.entries(rt.stationOccupancy || {});
    out.push(occ.length);
    for (const [k, n] of occ) out.push(+k, n);
    const outside = Object.entries(rt.outside || {});
    out.push(outside.length);
    for (const [id, q] of outside) {
      out.push(+id);
      tokens(out, q, rt.outsideSince, id);
      c.limitIds.add(+id);
    }
    const queues = Object.entries(rt.queues || {});
    out.push(queues.length);
    for (const [k, q] of queues) {
      const [id, dir, station] = k.split('|');
      out.push(named(c, id), +dir, +station);
      tokens(out, q, rt.waitSince, k);
      c.limitIds.add(+station);
    }
    out.push(rt.transfers.length);
    for (const x of rt.transfers) out.push(x.journey, x.leg, x.amount, x.ready, x.station);
  }

  function parts(c, rt, s, job, resume) {
    const full = Core.queueToken() !== c.token;
    if (full) {
      c.sent = 0;
      c.seen = new WeakSet();
    }
    const definition = [];
    defs(c, rt, s, definition);
    const fresh = rt.trains.filter(t => !c.seen.has(t)),
      trainData = [];
    trainData.push(fresh.length);
    for (const t of rt.trains) c.trains.set(uid(t), {
      t,
      l: t.retiringRun || job.index.runs.get(t.service)
    });
    for (const t of fresh) {
      c.seen.add(t);
      trainData.push(uid(t), named(c, t.service), named(c, t.parentLine || t.service), t.capacity,
        t.dir, +t.loop, (t.retiringRun || job.index.runs.get(t.service))?.cars || 6, t.stops
        .length, ...t.stops, t.callStops.length, ...t.callStops, t
        .onboard);
      tokens(trainData, t.passengers);
    }
    const snapshot = [];
    if (full) fullState(c, rt, snapshot);
    for (const id of Object.keys(rt.stationLimits || {})) c.limitIds.add(+id);
    const limits = [c.limitIds.size];
    for (const id of c.limitIds) {
      let l = rt.stationLimits[id] || c.fallbackLimits.get(id);
      if (!l) {
        l = Q.limits(s, id);
        c.fallbackLimits.set(id, l);
      }
      limits.push(id, l.capacity, l.outsideCapacity);
    }
    const motion = resume ? new Float64Array(0) : job.motion.input;
    const ops = resume?.ops || [],
      arrivals = resume ? [] : job.arrivals;
    const header = [c.sparse?3:2, c.token, resume ? 1 : 0, +full, rt.minute, s.routeModel === 9 ? 1 : 0, rt
      .arrivalMode === 'integer' ? 1 : 0, X.TRANSFER, resume ? 0 : +job.gates, resume?.cursor ||
      0, resume?.original ?? -1, resume?.next ?? -1, resume?.amount || 0, motion.length
    ];
    const tail = [rt.trains.length, ...rt.trains.map(uid), ops.length / 4, ...ops, arrivals
      .length
    ];
    arrivals.forEach((a, i) => {
      const ids = a.j.lineIds || [];
      tail.push(a.id, i, a.n, ids.length, ...ids.map(id => named(c, id)));
    });
    const statistics = Q.nativeStatisticsFrame(c, s, rt, full);
    const finance = job.settlement ? Engine.encode(c, rt, job.settlement, named, full) : null;
    return {parts:[header,motion,definition,limits,trainData,snapshot,tail,statistics],finance};
  }
  function packetFrame(c,rt,s,job,resume) {
    const frame=parts(c,rt,s,job,resume),finance=frame.finance;
    const size=frame.parts.reduce((n,p)=>n+p.length,0);
    // Encode directly into the transaction buffer; avoid a second full queue copy.
    const input = new Float64Array(size + (finance ? 2 + finance.length : 0));
    let at = finance ? 2 : 0;
    for (const part of frame.parts) {
      input.set(part, at);
      at += part.length;
    }
    if(!finance)return {name:'simulation_step',input};
    input.set([size,finance.length]);input.set(finance,at);
    return {name:'engine_step',input};
  }
  function unpack(request,result) {
    return request.name==='engine_step'?{queue:result.subarray(3,3+result[1]),finance:result.subarray(3+result[1])}:{queue:result};
  }
  function packet(...args) {
    const request=packetFrame(...args);
    return unpack(request,Core.kernel(request.name,request.input));
  }

  function poseTrain(rt,job,t,action,progress,index,ready,finalIndex,finalReady) {
    if(action===1){t.status='finished';return;}
    if(action>=2&&action<=5) {
      t.progress=progress;
      if(action>=3) {
        t.index=index;t.status='dwell';t.ready=ready;t.progress=0;
        if(action===4){t.index=finalIndex;t.ready=finalReady;t.laps=(t.laps||0)+1;}
        else if(action===5)t.status='finished';
      }
    }else if(action===6)t.status='signal';
    else if(action===7) {
      const tr=job.track(rt,job.index,t,t.trackIds[t.dir===1?t.index:t.index-1]),
        from=t.stops[t.index],to=t.stops[t.index+t.dir],block=tr.id+'|'+(from===tr.a?1:-1);
      rt.blocks[block]=finalReady;t.status='moving';t.departedAt=rt.minute;t.arriveAt=ready;
      t.segment={track:tr.id,from,to};t.progress=0;
    }
  }
  function pose(rt,job,data) {
    for(let i=0;i<job.motion.context.length;i++) {
      const at=i*8;
      poseTrain(rt,job,job.motion.context[i].t,data[at],data[at+1],data[at+4],data[at+5],data[at+6],data[at+7]);
    }
  }
  function compactPose(c,rt,job,data) {
    let at=0;
    while(at<data.length) {
      const uid=data[at++],action=data[at++],t=c.trains.get(uid)?.t;
      if(!t)throw Error('原生列车投影缺失对应对象');
      if(action===1)t.status='finished';
      else if(action===6)t.status='signal';
      else if(action===2)t.progress=data[at++];
      else if(action===3||action===5) {poseTrain(rt,job,t,action,0,data[at],data[at+1]);at+=2;}
      else if(action===4) {poseTrain(rt,job,t,action,0,0,0,data[at],data[at+1]);at+=2;}
      else if(action===7) {poseTrain(rt,job,t,action,0,0,data[at],0,data[at+1]);at+=2;}
      else throw Error('未知原生列车投影操作');
    }
    if(at!==data.length)throw Error('原生列车投影长度无效');
  }

  function project(c, rt, s, job, data) {
    const pending = projectCommands(c, rt, s, job, data.queue);
    if (data.finance?.length) Engine.project(rt, job.settlement, data.finance);
    return pending;
  }

  function projectCommands(c, rt, s, job, data) {
    if (data[0] !== 1 && data[0]!==2) throw Error('队列事件协议版本错误');
    const motionLength = data[6],
      opsLength = data[7] * 4,
      dirty = data[8];
    let at = 17;
    if(motionLength) {
      const motion=data.subarray(at,at+motionLength);
      if(data[0]===2)compactPose(c,rt,job,motion);else pose(rt,job,motion);
    }
    at += motionLength;
    const ops = data.slice(at, at + opsLength);
    at += opsLength;
    const statistics = Q.nativeStatisticsProjector(c, s, rt);
    const transferDeletes = [];
    const compactTransfers = () => {
      if (!transferDeletes.length) return;
      let deleted = 0,
        kept = 0;
      for (let read = 0; read < rt.transfers.length; read++) {
        if (read === transferDeletes[deleted]) deleted++;
        else rt.transfers[kept++] = rt.transfers[read];
      }
      rt.transfers.length = kept;
      transferDeletes.length = 0;
    };
    let lastToken = '',
      tj = -1,
      tl = -1,
      ts = -2,
      qid = -1,
      qdir = 0,
      qstation = -1,
      qkey = '';
    const tok = (j, l, stamp) => {
      if (tj !== j || tl !== l || ts !== stamp) {
        tj = j;
        tl = l;
        ts = stamp;
        lastToken = j + ':' + l + (stamp >= 0 ? ':' + stamp : '');
      }
      return lastToken;
    };
    const key = (id, dir, station) => {
      if (id !== qid || dir !== qdir || station !== qstation) {
        qid = id;
        qdir = dir;
        qstation = station;
        qkey = c.names[id] + '|' + dir + '|' + station;
      }
      return qkey;
    };
    const update = (obj, k, v) => {
      if (Number.isNaN(v)) delete obj[k];
      else obj[k] = v;
    };
    for (; at < data.length; at += 8) {
      const op = data[at],
        a = data[at + 1],
        b = data[at + 2],
        d = data[at + 3],
        e = data[at + 4],
        f = data[at + 5],
        g = data[at + 6],
        h = data[at + 7];
      if (op >= 32 && op < 48) {
        statistics(data, at);
        continue;
      }
      switch (op) {
        case 54: {
          const t=c.trains.get(a)?.t;if(!t)break;
          t.status=['dwell','moving','signal','finished'][b];t.index=d;t.progress=e;t.ready=h;
          if(f)t.departedAt=f;else delete t.departedAt;if(g)t.arriveAt=g;else delete t.arriveAt;
          if(t.status==='moving'){const i=t.dir===1?t.index:t.index-1;t.segment={track:t.trackIds[i],from:t.stops[t.index],to:t.stops[t.index+t.dir]};}
          break;
        }
        case 56: {const t=c.trains.get(a)?.t;if(t){t.segment=Number.isNaN(b)?null:{track:t.trackIds[t.dir===1?b:b-1],from:t.stops[b],to:t.stops[b+t.dir]};}break;}
        case 55: {const t=c.trains.get(a)?.t;if(t){if(Number.isNaN(b))delete t.laps;else t.laps=b;}break;}
        case 57: rt.nextId=a;rt.expectedGenerated=b;rt.arrivalRemainder=d;rt.rngState=e;rt.demandCarry=f;rt.minute=g;break;
        case 58: {const name=SIM.blockNames(c.original||rt)[a];if(name)rt.blocks[name]=b;break;}
        case 48: {
          const view={minute:rt.minute,summary:{waiting:a,outside:b,transferring:d,onboard:e},queues:{},outside:{},transfers:[],stations:{}};
          views.set(rt,view);
          if(!Object.getOwnPropertyDescriptor(rt,'nativeView'))Object.defineProperty(rt,'nativeView',{get:()=>views.get(rt),configurable:true});
          break;
        }
        case 49: {
          const view=views.get(rt);view.queues[key(a,b,d)]={total:e};view.stations[d]=(view.stations[d]||0)+e;break;
        }
        case 50: views.get(rt).outside[a]={total:b};break;
        case 51: {
          const view=views.get(rt);view.transfers.push({station:a,amount:b});view.stations[a]=(view.stations[a]||0)+b;break;
        }
        case 17: rt.queues[key(a,b,d)]=rt.queues[key(a,b,d)]||{};break;
        case 3: {
          const k = key(a, b, d),
            q = rt.queues[k] || (rt.queues[k] = {});
          update(q, tok(e, f, g), h);
          break;
        }
        case 4:
          update(rt.waitSince, key(a, b, d) + '#' + tok(e, f, g), h);
          break;
        case 5: {
          const q = rt.outside[a] || (rt.outside[a] = {});
          update(q, tok(b, d, e), f);
          break;
        }
        case 6:
          update(rt.outsideSince, a + '#' + tok(b, d, e), f);
          break;
        case 7:
          rt.stationOccupancy[a] = b;
          break;
        case 8:
          if(c.trains.has(a))update(c.trains.get(a).t.passengers, tok(b, d, e), f);
          break;
        case 9:
          if(c.trains.has(a))c.trains.get(a).t.onboard = b;
          break;
        case 10:
          if(c.trains.has(a))c.trains.get(a).t.passengers = {};
          break;
        case 11:
          compactTransfers();
          rt.transfers.push({
            journey: a,
            leg: b,
            amount: d,
            ready: e,
            station: f
          });
          break;
        case 12:
          transferDeletes.push(a + transferDeletes.length);
          break;
        case 13:
          rt.lineRevenue[c.names[a]] = b;
          break;
        case 14:
          rt.lineBoarded[c.names[a]] = b;
          break;
        case 15:
          rt.purposeCompleted[c.purposes[a]] = b;
          break;
        case 16:
          rt.outside[a] = rt.outside[a] || {};
          break;
        default:
          throw Error('未知队列事件 ' + op);
      }
    }
    compactTransfers();
    for (let i = 0; i < 8; i++)
      if (dirty & (1 << i)) rt[counters[i]] = data[9 + i];
    return data[1] ? {
      cursor: data[2],
      original: data[3],
      station: data[4],
      amount: data[5],
      ops
    } : null;
  }

  function step(rt, s, index, track, arrivals, gates, reroute, settlement = null) {
    const c = cache(rt, s);
    // New games / compacted archives can release the previous arena before rehydration.
    // Do this before encoding motion so both native state machines receive full layouts.
    if (!c.sent && Core.queueToken() !== c.token && Core.status().memoryBytes > 64 * 1024 *
      1024) {
      Core.recycleSimulation();
    }
    const job = {
      settlement,
      index,
      track,
      arrivals,
      gates,
      motion: SIM.incremental(rt, s, index, track, uid)
    };
    let pending = project(c, rt, s, job, packet(c, rt, s, job, null));
    while (pending) {
      const next = reroute(rt, rt.defs[pending.original], pending.station);
      pending.next = next?.id ?? -1;
      pending = project(c, rt, s, job, packet(c, rt, s, job, pending));
    }
    rt.trains = rt.trains.filter(t => t.status !== 'finished');
    const alive = new Set(rt.trains.map(uid));
    for (const id of c.trains.keys())
      if (!alive.has(id)) c.trains.delete(id);
  }
  const catalogs=new WeakMap();
  function catalogToken(catalog) {
    if(!catalogs.has(catalog)) catalogs.set(catalog,Core.allocateToken());
    return catalogs.get(catalog);
  }
  function finish(c,rt) {
    rt.trains=rt.trains.filter(t=>t.status!=='finished');
    const alive=new Set(rt.trains.map(uid));
    for(const id of c.trains.keys()) if(!alive.has(id)) c.trains.delete(id);
  }
  // The only identity allocation is native. These objects are save/UI projections.
  function trainView(rt,s,source,ordinal,id,c,job) {
    const {l,dir,dwell,loop}=source;
    const t={id:'T'+String(ordinal).padStart(4,'0'),service:l.id,parentLine:l.parentLine||l.id,
      callStops:l.callStops||l.stops,dir,stops:[...l.stops],trackIds:[...l.trackIds],
      index:dir===1?0:l.stops.length-1,status:'dwell',ready:rt.minute+dwell,
      onboard:0,capacity:R.capacity(l),passengers:{},progress:0,loop,segment:null};
    identities.set(t,id);rt.trains.push(t);c.trains.set(id,{t,l});c.seen.add(t);
    job.motion.context.push({t,l});
  }
  function* cycle(rt,s,index,track,frames,reroute,settlement,journeyKey) {
    const c=cache(rt,s),catalog=rt.demandCatalog||rt.defs;
    c.journeyKey=journeyKey;
    if(c.sparse)SIM.trackCatalog(catalog);
    // Forecast workspaces must not coexist with a newly rehydrated continuous arena.
    if(!c.sent&&Core.queueToken()!==c.token&&Core.status().memoryBytes>64*1024*1024)
      Core.recycleSimulation();
    const job={settlement,index,track,arrivals:[],gates:rt.arrivalMode==='integer'&&!!frames.sampling};
    let requests=[],needsKeys=false;
    let requested=new Set();
    let result,stableFrame=null,stableMotion=null,stableSampling=null,preparedInNative=false;
    // A metadata miss has no game-side effects. Replay the same random seed/clock,
    // supply only the selected catalog templates, then commit one complete transaction.
    for(let attempt=0;attempt<4096;attempt++) {
      if(Core.cycleToken()!==c.token) {c.keySent=0;stableFrame=null;stableMotion=null;stableSampling=null;preparedInNative=false;}
      const keyMode=needsKeys||c.keySent&&c.keySent<rt.defs.length?(c.keySent?2:1):0;
      const text=[],keyRows=[],profiles=[],encoder=new TextEncoder();
      let byteLength=0;
      const string=value=>{const b=encoder.encode(value),off=byteLength;byteLength+=b.length;text.push(b);return [off,b.length];};
      if(keyMode) for(let i=keyMode===1?0:c.keySent;i<rt.defs.length;i++)
        keyRows.push(i,...string(journeyKey(rt.defs[i])));
      for(const p of requested) {
        const j=catalog[p],data=[];definition(c,j,s,data,index.runs);
        profiles.push(p,j.legs[0]?named(c,j.legs[0].service):-1,...string(journeyKey(j)),data.length,...data);
      }
      // Metadata calls finish before encoding any cache-dependent frames.
      job.motion=stableMotion||(stableMotion=SIM.incremental(rt,s,index,track,uid,frames.dispatch?.context||[]));
      if(c.sparse)job.motion.input[0]=11;
      const templates=[job.motion.templates.length];
      for(const t of job.motion.templates) {
        if(t.skip){templates.push(0,0,0);continue;}
        const {l,dir,loop,dwell}=t;
        const q=[named(c,l.id),named(c,l.parentLine||l.id),R.capacity(l),dir,+loop,l.cars||6,
          l.stops.length,...l.stops,(l.callStops||l.stops).length,...(l.callStops||l.stops),0,0];
        templates.push(q.length,t.data.length,dwell,...q,...t.data);
      }
      // Re-encode sampling after a native arena recycle; never replay a delta into an empty cache.
      const sampling=frames.sampling?(stableSampling||(stableSampling=SIM.timedFrame(catalog,s,frames.minute,frames.interval,
        rt.arrivalRemainder||0,rt.rngState,job.gates))):null;
      const prep=preparedInNative?new Float64Array(0):(Prepare.encode(frames.feedback,sampling,frames.dispatch)||new Float64Array([1,0,0,0,0]));
      const rules=[frames.sampling?s.services.length:0];
      for(const l of frames.sampling?s.services:[]) rules.push(named(c,l.id),l.open??0,l.close??1440,+!!l.fleetManaged,l.fleet);
      const feedbackIds=(frames.feedback?.context.ls||[]).map(l=>named(c,l.id));
      const frame=stableFrame||(stableFrame=parts(c,rt,s,job,null)),fin=frame.finance||[];
      const sections=[feedbackIds,keyRows,profiles,templates,rules,prep,fin,...frame.parts];
      const input=new Float64Array(30+sections.reduce((n,p)=>n+p.length,0));
      input.set([2,c.token,catalogToken(catalog),rt.defs.length,trainSerial,rt.nextId,keyMode,
        keyRows.length/3,requested.size,feedbackIds.length,prep.length,fin.length,templates.length,rules.length,
        job.motion.input[1],sampling?.input[1]||0,fin[1]||0,...frame.parts.map(p=>p.length),+c.sparse,rt.expectedGenerated||0,rt.arrivalRemainder||0,rt.rngState,rt.demandCarry||0]);
      let at=30;for(const part of sections) {input.set(part,at);at+=part.length;}
      const bytes=new Uint8Array(byteLength);at=0;for(const part of text){bytes.set(part,at);at+=part.length;}
      result=yield {name:'engine_cycle',input,bytes};
      if(keyMode&&Core.cycleToken()===c.token)c.keySent=rt.defs.length;
      if(result[1]===0) break;
      preparedInNative=Core.cycleToken()===c.token;
      needsKeys=needsKeys||!!result[2];
      requests=Array.from(result.subarray(11,11+result[3]));
      requested=new Set(requests);
      if(attempt===4095)throw Error('原生运行元数据未能收敛');
    }
    yield* applyCycle(c,rt,s,job,result,frames,catalog,journeyKey,reroute);
    c.lastJob=job;c.lastFinance=stableFrame.finance;c.calendarReady=false;c.rebasePending=false;
    if(c.sparse)releaseDetails(rt);
  }
  function* applyCycle(c,rt,s,job,result,frames,catalog,journeyKey,reroute) {
    let at=11;
    for(let i=0;i<result[4];i++,at+=2) {
      const p=result[at],id=result[at+1];
      if(id!==rt.defs.length) throw Error('原生出行编号不连续');
      const j={...catalog[p],id,daily:0};rt.defs.push(j);
      if(rt._demandIndex)rt._demandIndex.set(journeyKey(j),j);
    }
    c.sent=rt.defs.length;
    if(c.keySent)c.keySent=rt.defs.length;
    for(let i=0;i<result[5];i++,at+=3)
      trainView(rt,s,job.motion.templates[result[at+1]],result[at+2],result[at],c,job);
    trainSerial=Math.max(trainSerial,result[6]);rt.nextId=result[7];
    const prepared=result.subarray(at,at+result[8]);at+=result[8];
    let p=4;
    if(frames.feedback)Native.projectFeedback(frames.feedback,prepared.subarray(p,p+prepared[1]));
    p+=prepared[1];
    if(prepared[2]) {
      const sampled=SIM.projectArrivals(prepared.subarray(p,p+prepared[2]));
      if(job.gates) {rt.expectedGenerated=(rt.expectedGenerated||0)+sampled.total;
        rt.arrivalRemainder=sampled.remainder;rt.rngState=sampled.rng;}
    }
    p+=prepared[2];
    if(frames.dispatch)for(const d of SIM.projectDispatch(frames.dispatch,prepared.subarray(p))) {
      if(d.action<0)continue;
      if(d.action===1)d.d.lastRun=rt.minute;
      d.d.next=d.next;
    }
    let pending=project(c,rt,s,job,{queue:result.subarray(at,at+result[9]),finance:result.subarray(at+result[9])});
    while(pending) {
      const next=reroute(rt,rt.defs[pending.original],pending.station);
      pending.next=next?.id??-1;
      const request=packetFrame(c,rt,s,job,pending);
      pending=project(c,rt,s,job,unpack(request,yield request));
    }
    finish(c,rt);
  }
  function calendarFrame(c,rt,s,job) {
    const T=node?require('./temporal-wasm'):root.RailTemporal;
    const F=node?require('./fleet'):root.RailFleet;
    const dispatch=SIM.dispatchFrame(rt,s,job.index,true);
    const contexts=dispatch?.context||[];
    const motion=SIM.incremental(rt,s,job.index,job.track,uid,contexts,true);
    const feedback=Native.feedbackFrame(s,rt,1,true);
    const sampling=SIM.timedFrame(rt.demandCatalog||rt.defs,s,rt.minute,0,rt.arrivalRemainder||0,rt.rngState,rt.arrivalMode==='integer');
    const bases=new Map((s.baseLines||s.services).map((l,i)=>[l.id,{l,i}]));
    const runs=s.services, runIds=new Map(runs.map((l,i)=>[l.id,i]));
    const data=[1,c.token,catalogToken(rt.demandCatalog||rt.defs),job.motion.input[1],sampling.input[1],
      motion.blocks,trainSerial,rt.nextId,rt.fleetMinute??-1,rt.demandCarry||0,rt.arrivalRemainder||0,
      rt.rngState,rt.expectedGenerated||0,s.ridership.lastMinute,+(rt.arrivalMode==='integer'),X.TRANSFER,runs.length];
    for(const l of runs) {
      const base=bases.get(l.parentLine||l.id),managed=!!base?.l.fleetManaged;
      const ds=X.directions(l),isLoop=l.stops[0]===l.stops.at(-1);
      data.push(named(c,l.id),named(c,l.parentLine||l.id),base?.i??-1,X.duration(s,l),l.headway,+isLoop,ds.length,
        new Set(l.callStops||l.stops).size,l.open??0,l.close??1440,+managed,
        managed?F.allocations(base.l,720)[l.patternIndex||0]:l.fleet,
        managed?F.allocations(base.l,480)[l.patternIndex||0]:l.fleet,
        managed?F.planned(base.l,720):(base?.l.fleet??l.fleet),managed?F.planned(base.l,480):(base?.l.fleet??l.fleet),l.fleet,
        (l.fareLines||[]).length,...(l.fareLines||[]).map(id=>named(c,id)));
    }
    data.push(contexts.length);
    for(const x of contexts) data.push(runIds.get(x.l.id),x.dir,+!!x.d,x.d?.next||0,x.d?.headway||0,
      +(x.d?.lastRun!=null),x.d?.lastRun||0);
    const templates=[motion.templates.length];
    for(const t of motion.templates) {
      const l=t.l,q=[named(c,l.id),named(c,l.parentLine||l.id),R.capacity(l),t.dir,+t.loop,l.cars||6,
        l.stops.length,...l.stops,(l.callStops||l.stops).length,...(l.callStops||l.stops),0,0];
      templates.push(q.length,t.data.length,t.dwell,...q,...t.data);
    }
    const ids=feedback.context.ls.map(l=>named(c,l.id)),mapping=sampling.context.names.map(id=>feedback.context.ids.get(id)??-1);
    for(const section of [templates,feedback.input,sampling.input,ids,mapping]) {
      data.push(section.length);for(const value of section)data.push(value);
    }
    data.push(+c.sparse);
    c.calendar={feedback,sampling,dispatch,motion,journeyKey:c.journeyKey};
    return new Float64Array(data);
  }
  function* autonomous(rt,s,minutes,options) {
    s=rt.plan||s;
    const c=states.get(rt),job=c?.lastJob;
    if(!job?.settlement||c.plan!==s||Core.queueToken()!==c.token||s.routeModel!==9||!s.ridership||
      rt.trains.some(t=>t.retiringRun)||rt.defs.length>45000)return null;
    if(!SIM.canCalendar(rt.demandCatalog||rt.defs))return null;
    const fin=Engine.continuation(c,rt,job.settlement,c.lastFinance);
    if(!fin||minutes<.1)return null;
    const world=job.settlement.world;
    // Rust advances the 15-minute windows; day archiving remains a host transaction.
    let barrier=420+Q.day(rt.minute)*1440;
    if(world.urban)barrier=Math.min(barrier,world.urban.lastMinute+360-1e-7);
    if(world.operationsReview)barrier=Math.min(barrier,world.operationsReview.nextAt-1e-7);
    if(rt.minute+.1>=barrier-1e-8)return null;
    const demand=SIM.demandStatus(rt.demandCatalog||rt.defs);
    if(!demand?.managed||demand?.pending||demand?.untracked)c.calendarReady=false;
    const meta=c.calendarReady?new Float64Array(0):calendarFrame(c,rt,s,job);
    const input=new Float64Array(8+fin.length+meta.length);
    input.set([c.token,rt.minute,minutes,options.maxSteps,options.budget,barrier,fin.length,meta.length]);
    input.set(fin,8);input.set(meta,8+fin.length);
    const result=yield {name:'engine_loop',input,now:options.now};
    c.calendarReady=true;
    let at=5;
    for(let i=0;i<result[1];i++) {
      rt.minute=result[at++];rt.demandCarry=result[at++];const interval=result[at++],changed=result[at++],nv=result[at++],nr=result[at++];
      if(changed) {
        rt.fleetMinute=Math.floor(rt.minute);
        const n=result[at++];
        for(let k=0;k<n;k++)s.services[k].fleet=result[at++];
        const nd=result[at++];
        for(let k=0;k<nd;k++) {
          const d=c.calendar.dispatch.context[k].d;
          const next=result[at++],h=result[at++];
          if(d){d.next=next;d.headway=h;}
        }
      }else at+=nv;
      const reply=result.subarray(at,at+nr);at+=nr;
      if(interval)Q.step(s,rt,interval,()=>{});
      const frames={feedback:interval?c.calendar.feedback:null,dispatch:reply[8]&&reply[11+reply[3]+reply[4]*2+reply[5]*3+3]?c.calendar.dispatch:null};
      job.motion.templates=c.calendar.motion.templates;
      job.gates=rt.arrivalMode==='integer'&&!!interval;
      yield* applyCycle(c,rt,s,job,reply,frames,rt.demandCatalog||rt.defs,c.journeyKey,options.reroute);
    }
    if(result[4]) {projectCommands(c,rt,s,job,result.subarray(at,at+result[4]));at+=result[4];}
    if(c.sparse)releaseDetails(rt);
    if(at!==result.length)throw Error('原生多步结果长度无效');
    return {steps:result[1],remaining:result[2],running:result[3]!==2,reason:result[3]};
  }
  function* continueRun(rt,s,minutes,options) {
    s=rt.plan||s;
    const c=states.get(rt),job=c?.lastJob;
    if(!job?.settlement||c.plan!==s||Core.queueToken()!==c.token) return null;
    let barrier=Math.floor(rt.minute)+1;
    for(const d of Object.values(rt.departures))barrier=Math.min(barrier,d.next-1e-8);
    const world=job.settlement.world;
    if(world.urban)barrier=Math.min(barrier,world.urban.lastMinute+360-1e-7);
    if(world.operationsReview)barrier=Math.min(barrier,world.operationsReview.nextAt-1e-7);
    if(rt.minute+.1>=barrier-1e-8||minutes<.1)return null;
    const fin=Engine.continuation(c,rt,job.settlement,c.lastFinance);
    if(!fin)return null;
    const input=new Float64Array([c.token,rt.minute,minutes,options.maxSteps,options.budget,barrier,
      +!!s.ridership,...fin,...[s.routeModel===9?1:0,rt.arrivalMode==='integer'?1:0,X.TRANSFER,+c.sparse]]);
    const result=yield {name:'engine_continue',input,now:options.now};
    let at=4;
    for(let i=0;i<result[1];i++) {
      rt.minute=result[at++];rt.demandCarry=result[at++];const nq=result[at++],nf=result[at++];
      let pending=project(c,rt,s,job,{queue:result.subarray(at,at+nq),finance:result.subarray(at+nq,at+nq+nf)});
      at+=nq+nf;
      while(pending) {
        const next=options.reroute(rt,rt.defs[pending.original],pending.station);
        pending.next=next?.id??-1;
        const request=packetFrame(c,rt,s,job,pending);
        pending=project(c,rt,s,job,unpack(request,yield request));
      }
      finish(c,rt);
    }
    if(at<result.length)projectCommands(c,rt,s,job,result.subarray(at));
    if(c.sparse)releaseDetails(rt);
    return {steps:result[1],remaining:result[2],running:result[3]!==2,reason:result[3]};
  }
  function releaseDetails(rt) {
    materialized.delete(rt);
    rt.queues={};rt.waitSince={};rt.outside={};rt.outsideSince={};rt.transfers=[];
    for(const t of rt.trains)if(Object.keys(t.passengers).length)t.passengers={};
  }
  function* query(rt,kind=1,entity=-1) {
    const c=states.get(rt);
    if(!c?.sparse||c.rebasePending||c.plan!==rt.plan)return rt;
    const train=kind===4?rt.trains.find(t=>t.id===entity):null;
    if(kind===4&&!train)return {...rt,trains:[]};
    const id=kind===4?uid(train):entity;
    const data=yield {name:'runtime_query',input:new Float64Array([c.token,kind,id])};
    const temp={...rt,blocks:{...rt.blocks},trains:rt.trains.map(t=>({...t,passengers:{}})),queues:{},waitSince:{},outside:{},outsideSince:{},transfers:[]};
    const byId=new Map(temp.trains.map(t=>[t.id,t]));
    const codec={...c,original:rt,trains:new Map([...c.trains].map(([id,x])=>[id,{...x,t:byId.get(x.t.id)}]).filter(([,x])=>x.t))};
    projectCommands(codec,temp,rt.plan,c.lastJob,data);
    return temp;
  }
  function sync(generator) {
    return Core.transaction(()=>{
      let step=generator.next();
      while(!step.done) {
        const request=step.value;
        const result=Core.withClock(request.now,()=>Core.kernel(request.name,request.input,null,null,request.bytes));
        step=generator.next(result);
      }
      return step.value;
    });
  }
  const clients=new WeakMap();
  function client(rt) {
    if(!clients.has(rt)) {
      const W=node?require('./simulation-client'):root.RailSimulationClient;
      if(!node&&rt.plan?.routeModel===9)nativeViews.add(rt);
      clients.set(rt,W.create({retainRuntime:nativeViews.has(rt),onLocal:()=>{nativeViews.delete(rt);views.delete(rt);const c=states.get(rt);if(c)c.sparse=false;}}));
    }
    return clients.get(rt);
  }
  const api = {
    continueRun:(...args)=>sync(autonomous(...args))||sync(continueRun(...args)),
    continueAsync:(...args)=>client(args[0]).run(()=>autonomous(...args)).then(result=>result||client(args[0]).run(()=>continueRun(...args))),
    cycleAsync:(...args)=>client(args[0]).run(()=>cycle(...args)),
    invalidate:rt=>{views.delete(rt);const c=states.get(rt);if(c){c.calendarReady=false;c.rebasePending=true;}},
    canSnapshot:rt=>!nativeViews.has(rt)||materialized.has(rt)||!views.has(rt),
    nativeViews:(rt,value=true)=>{if(value){nativeViews.add(rt);SIM.trackCatalog(rt.demandCatalog||rt.defs);}else nativeViews.delete(rt);if(states.has(rt))states.get(rt).sparse=value;},
    queryAsync:(...args)=>client(args[0]).run(()=>query(...args)),
    materializeAsync:async rt=>{
      const temp=await client(rt).run(()=>query(rt));
      if(temp!==rt){for(const k of ['queues','waitSince','outside','outsideSince','transfers'])rt[k]=temp[k];
        const trains=new Map(temp.trains.map(t=>[t.id,t]));for(const t of rt.trains)t.passengers=trains.get(t.id)?.passengers||{};}
      materialized.add(rt);return rt;
    },
    dispose:rt=>{clients.get(rt)?.close();clients.delete(rt);},
    step,cycle:(...args)=>sync(cycle(...args))
  };
  if (node) module.exports = api;
  else root.RailQueueRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
