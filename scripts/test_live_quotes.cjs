const assert=require('node:assert/strict'),L=require('../live-quotes.js');
const now=Date.parse('2026-10-21T07:32:00Z');
function raw(code,stamp='20261021150000',price='3713.03'){const f=Array(35).fill('');f[2]=code.slice(2);f[3]=price;f[30]=stamp;f[31]='-22.34';f[32]='-0.6';return f.join('~');}
function sina(code){const f=Array(32).fill('0');f[2]='3735.37';f[3]='3713.03';f[30]='2026-10-21';f[31]='15:00:00';return f.join(',');}
const q=L.parse(0,'sh000001',raw('sh000001'));
assert.equal(q.quote_at,'2026-10-21T15:00:00+08:00');assert(L.valid(q,null,now));assert(L.fresh(q,now));
assert(!L.valid({...q,price:0},null,now));assert(!L.valid({...q,price:null},null,now));assert(!L.valid({...q,quote_at:'2026-10-22T15:00:00+08:00'},null,now));assert(!L.valid(q,{quote_at:'2026-10-21T15:01:00+08:00'},now));
assert(!L.fresh(L.parse(0,'sh000001',raw('sh000001','20261021132200')),now));
assert(!L.fresh(L.parse(0,'sh000001',raw('sh000001','20261021145600')),now),'after close a 14:56 quote is still incomplete');
assert.equal(L.parse(2,'sh000001',{data:{f57:'000001',f59:2,f43:371303,f169:-2234,f170:-60,f86:Date.parse(q.quote_at)/1000}}).price,3713.03);
assert.throws(()=>L.parse(2,'sh000001',{data:{f57:'399006',f59:2}}));
assert(L.fresh(L.parse(0,'sh000001',raw('sh000001','20261021113000')),Date.parse('2026-10-21T04:15:00Z')),'lunch break accepts the morning close');
assert.equal(L.target(Date.parse('2026-10-24T04:15:00Z')),null,'weekends do not invent a trading session');
(async()=>{
 const calls=[];
 const report=await L.refresh([],now,async(provider,ids)=>{calls.push(provider);return Object.fromEntries(ids.map(id=>[id,provider===0?raw(id,'20261021132200'):sina(id)]));});
 assert.deepEqual(calls,[0,1]);assert.equal(report.freshCount,3);assert(report.rows.every(r=>r.source==='新浪财经'));
 const history=[{date:'2026-10-20',close:3700}],data={generated_at:'2026-10-21T05:22:00Z',markets:[{id:'sh000001',history,history_fetched_at:'yesterday'}],sources:[],news:[{id:'n'}],calendar:[{id:'c'}]};
 const applied=L.apply(data,report);assert.equal(applied.generated_at,data.generated_at);assert.equal(applied.markets[0].history,history);assert.equal(applied.news,data.news);assert.equal(applied.calendar,data.calendar);assert.equal(applied.markets[0].price,3713.03);assert.equal(applied.sources[0].mode,'backup');assert.equal(applied.sources[0].runtime,true);
 const east=await L.refresh([],now,async(provider,ids)=>{if(provider<2)throw Error('offline');return Object.fromEntries(ids.map(id=>[id,{data:{f57:id.slice(2),f59:2,f43:371303,f169:-2234,f170:-60,f86:Date.parse(q.quote_at)/1000}}]));});
 assert.equal(east.freshCount,3);assert(east.rows.every(r=>r.source==='东方财富'));
 const failed=await L.refresh(data.markets,now,async()=>{throw Error('offline')});const kept=L.apply(data,failed);assert.equal(failed.rows.length,0);assert.equal(kept.markets[0],data.markets[0]);
 const old=await L.refresh([],now,async(provider,ids)=>{if(provider>0)throw Error('offline');return Object.fromEntries(ids.map(id=>[id,raw(id,'20261021132200')]));});assert.equal(old.freshCount,0);assert.equal(old.rows.length,3);assert(L.apply(data,old).sources[0].quality.issues.length);
 console.log('Live quotes passed: stale primary failover, all three sources, rollback, lunch/weekend timing and unchanged news/history.');
})().catch(e=>{console.error(e);process.exit(1)});
