/* Frozen MAP54 JavaScript oracles; compare numeric fields, object order and source immutability. */
const assert = require('node:assert/strict');
const Q = require('../rail/ridership'), OldQ = require('./fixtures/rail-map54-ridership.cjs');
const H = require('../rail/flow-history'), OldH = require('./fixtures/rail-map54-flow-history.cjs');
const I = require('../rail/insights'), OldI = require('./fixtures/rail-map54-insights.cjs');
const Core = require('../rail/routing-wasm');
let checks=0,seed=20261109;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const exact=(a,b)=>{assert.deepEqual(a,b);assert.equal(JSON.stringify(a),JSON.stringify(b));checks++;};
const j={lineIds:[],fare:12.5,byLine:{}};
for(const malformed of [null,{}, {version:0,through:1859.9}, {version:1,since:420,through:1859.9,entered:[],boarded:[],completed:[]}, 'valid']) {
  for(const first of [430,1858.99,1859,1859.99999999,1860.1]) {
    const a={routeModel:9,services:[],economy:{minute:420}};
    Q.init(a,420);
    a.ridership.lines={b:{awareness:.37,trust:.91,bestDay:0},'2':{awareness:1,trust:.5,bestDay:0}};
    a.ridership.current.extra={retained:true};
    if(malformed!=='valid') a.ridership.current.flow=structuredClone(malformed);
    const b=structuredClone(a);
    for(let n=0;n<40;n++) {
      // Adjacent days, skips and backward edits all retain the previous archive semantics.
      const minute=n===0?first:420+n*1440+(n%3===0?0:13.7);
      Q.event(a,{minute},j,n%2?'complete':'enter',n+.25);
      OldQ.event(b,{minute},j,n%2?'complete':'enter',n+.25);
      exact(a,b);assert(a.ridership.history.length<=30);
    }
    Q.event(a,{minute:420},j,'enter',1);OldQ.event(b,{minute:420},j,'enter',1);exact(a,b);
  }
}
const values=[undefined,null,'13',NaN,Infinity,-Infinity,-0,0,-3,1,1e9,.00001];
for(let n=0;n<300;n++) {
 const a={},b={};for(const k of Q.RECORD_FIELDS){if(random()<.8)a[k]=values[Math.floor(random()*values.length)];if(random()<.8)b[k]=values[Math.floor(random()*values.length)];}
 exact(Q.mergeRecords(a,b),OldQ.mergeRecords(a,b));
}
for(let n=0;n<140;n++) {
 const d={number:1+Math.floor(random()*60)};
 const base=H.start(d);
 if(n%5!==0){d.flow={version:n%13===0?0:1,since:base+(n%9===0?0:random()*200),through:base+random()*1440};
  for(const k of H.FIELDS)d.flow[k]=Array.from({length:n%17===0?95:96},()=>random()<.7?0:Math.floor(random()*300)/4);
 }
 if(n===1){d.flow.since=base;d.flow.through=base+1440;d.flow.entered.fill(3);}
 const before=structuredClone(d);
 for(const field of [...H.FIELDS,'unknown'])for(const width of [15,30,60,17]){
  const actual=H.view(d,field,width),expected=OldH.view(d,field,width);exact(actual,expected);
  if(actual.peak)assert(actual.points.includes(actual.peak),'peak must reference its point');
 }
 assert.deepEqual(d,before,'history queries must be read-only');
}
for(let n=0;n<180;n++) {
 const tracks=Array.from({length:12},(_,i)=>({id:'t'+i,km:random()*20}));
 if(n%7===0)tracks.push({id:'t1',km:.3});
 const services=Array.from({length:6},(_,i)=>({id:'l'+i,trackIds:Array.from({length:Math.floor(random()*7)},()=>random()<.15?'missing':'t'+Math.floor(random()*12))}));
 if(n%5===0)services.push({id:'l0',trackIds:[]});
 const s={tracks,services,economy:{revenue:n*.012},ridership:{records:{totalPassengerKm:n/7}}};
 const before=structuredClone(s);exact(I.lengths(s),OldI.lengths(s));exact(I.records(s),OldI.records(s));assert.deepEqual(s,before);
}
for(const value of [-3,-0,0,99.99999989,99.99999991,100,999.9999999,1000,1e4,1e5,1e6,2e6,2e7,2e9]) {
 const r=Object.fromEntries(Q.RECORD_FIELDS.map(k=>[k,value]));
 exact(Q.awards(r),OldQ.awards(r));
 exact(Q.awards(Q.mergeRecords(r,r)),OldQ.awards(OldQ.mergeRecords(r,r)));
}
assert(Core.status().historyCalls>1000);
console.log(`MAP55 history: ${checks} frozen MAP54 comparisons; 07:00/skip/backward archives, maturity, 30-day cap, missing/zero/partial flow windows, peak ties, optional/nonfinite records, shared tracks, duplicate IDs and immutable queries.`);
