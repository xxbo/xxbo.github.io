const assert=require('node:assert/strict'),T=require('../technical.js'),C=require('../market-context.js');
function bars(count,close,offset=0){return Array.from({length:count},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i+offset)).toISOString().slice(0,10),close:close(i),high:close(i)+1,low:Math.max(.1,close(i)-1),volume:100}));}
const up=T.analyze(bars(160,i=>100+i)),down=T.analyze(bars(160,i=>400-i)),flat=T.analyze(bars(160,()=>100));
const u=C.analyze(up),d=C.analyze(down),f=C.analyze(flat);
assert.equal(u.activity.ratio,1);assert(u.activity.lastReturn>0);assert.equal(u.stage,'上行结构');assert.equal(d.stage,'下行结构');assert.equal(f.stage,'均线交错，方向分歧');
assert.equal(u.delta.from,up.series.at(-6).date);assert(Math.abs(u.delta.return-(259/254-1)*100)<1e-10);
assert.equal(u.range.high,258);assert.equal(u.range.low,239); // latest close is excluded from the reference range.
assert.equal(f.vol.value,0);assert.equal(f.vol.percentile,50);assert.equal(f.scenarios.some(s=>s.met),false);
assert(C.analyze(T.analyze(bars(80,()=>100))).vol.percentile===null);
assert(C.analyze(T.analyze(bars(81,()=>100))).vol.percentile!==null);
assert.equal(C.analyze(T.analyze([])).available,false);
assert.equal(C.analyze(T.analyze(bars(19,i=>100+i))).available,false);
assert.equal(C.analyze(T.analyze(bars(20,i=>100+i))).horizons[1].bias,null);
const partial=T.analyze([...bars(160,i=>100+i),{date:'2025-12-31',close:1000000,partial:true}]);assert.deepEqual(C.analyze(partial),u);
const riskBars=bars(160,i=>i<139?100+(i%2)*.1:100+(i%2)*20);assert(C.analyze(T.analyze(riskBars)).vol.percentile>90);
const recover=T.analyze(bars(160,i=>i<150?400-i:260+(i-150)*4));assert.equal(C.analyze(recover).stage,'中期偏弱，短线修复');
const pullback=T.analyze(bars(160,i=>i<150?100+i:240-(i-150)*4));assert.equal(C.analyze(pullback).stage,'中期偏强，短线回撤');
const same=C.compare(up,up,20);assert(same.available);assert.equal(same.excess,0);assert.equal(same.rows[0].left,100);assert.equal(same.rows.length,21);assert(same.alignedLatest);
const b=T.analyze(bars(160,i=>200+i*2).slice(0,-1).filter((_,i)=>i!==145)),aligned=C.compare(up,b,20);
assert(aligned.available);assert.equal(aligned.to,b.asof);assert.equal(aligned.alignedLatest,false);assert(!aligned.rows.some(r=>r.date===up.bars[145].date));assert(Math.abs(aligned.excess)<1e-10);
assert.equal(C.compare(up,T.analyze(bars(10,i=>100+i)),20).available,false);
const positive=T.analyze(bars(160,i=>100+i+i*i*.01));assert(C.analyze(positive).scenarios[0].met);assert(!C.analyze(positive).scenarios[1].met);
assert(!C.analyze(T.analyze(bars(20,i=>100+i))).scenarios[0].met);
console.log('Market context checks passed: regimes, historical windows, sample thresholds, partial bars, volatility ranks, aligned dates and symmetric validation.');
