/* Cold-query cost only; does not measure autonomous Worker simulation, map rendering or FPS. */
const assert=require('node:assert/strict');
const H=require('../rail/flow-history'),OldH=require('./fixtures/rail-map54-flow-history.cjs');
const I=require('../rail/insights'),OldI=require('./fixtures/rail-map54-insights.cjs');
const Q=require('../rail/ridership'),OldQ=require('./fixtures/rail-map54-ridership.cjs');
const d={number:3};H.touch(d,3350);d.flow.entered=d.flow.entered.map((_,i)=>i%5?i*.125:0);H.touch(d,4500);
const s={tracks:Array.from({length:30},(_,i)=>({id:'t'+i,km:(i+1)*.013})),services:Array.from({length:10},(_,i)=>({id:'l'+i,trackIds:Array.from({length:6},(_,j)=>'t'+((i*3+j)%30))})),economy:{revenue:1e6},ridership:{records:{totalPassengerKm:8000}}};
const r={bestDay:1000,bestHour:300,totalCompleted:8000,totalPassengerKm:20000,bestNetworkKm:30,bestLineKm:10,bestRevenue:1e6};
const tasks=[['flowView',()=>OldH.view(d),()=>H.view(d)],['networkLengths',()=>OldI.lengths(s),()=>I.lengths(s)],['recordMerge',()=>OldQ.mergeRecords(r,r),()=>Q.mergeRecords(r,r)],['awards',()=>OldQ.awards(r),()=>Q.awards(r)]];
const count=1000,results=[];
for(const [name,old,current] of tasks){
 assert.deepEqual(current(),old());for(let i=0;i<200;i++){old();current();}
 const samples=[[],[]];
 for(let round=0;round<6;round++)for(const v of round%2?[1,0]:[0,1]){
  const fn=v?current:old,start=performance.now();for(let i=0;i<count;i++)fn();samples[v].push((performance.now()-start)*1000/count);
 }
 const median=a=>a.sort((a,b)=>a-b)[3];
 results.push({name,unit:'microseconds/query',map54:median(samples[0]),map55:median(samples[1])});
}
console.log(JSON.stringify({workload:'Same process, alternating order; 200 warmup + 6 x 1000 queries per version; cold adapters included',results},null,2));
