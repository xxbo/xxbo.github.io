const assert = require('node:assert/strict');
const T = require('../technical.js');
// Wilder's published worksheet first RSI: 70.464135... after 14 price changes.
const reference = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
assert.ok(Math.abs(T.rsi(reference)[14]-70.464135)<.00001);
assert.equal(T.rsi(Array(30).fill(10)).at(-1),50);
assert.equal(T.rsi(Array.from({length:40},(_,i)=>i+1)).at(-1),100);
assert.equal(T.rsi(Array.from({length:40},(_,i)=>40-i)).at(-1),0);
const bars=Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),close:i+1,open:i+1,high:i+2,low:i,volume:100}));
const a=T.analyze(bars);
assert.equal(a.current.ma20,70.5);
// An arithmetic progression with SMA-seeded EMAs has analytically known DIF=7.
assert.equal(a.current.dif,7);
assert.equal(a.current.dea,7);
assert.equal(a.current.hist,0);
assert.equal(a.volumeRatio,1);
const bb=T.analyze(bars.slice(0,20)).current.bb;
assert.ok(Math.abs(bb.upper-(10.5+2*Math.sqrt(33.25)))<1e-10);
// A huge unclosed daily quote must not affect completed-day indicators.
const b=T.analyze([...bars,{date:'2026-01-01',close:100000,partial:true}]);
assert.equal(a.current.close,b.current.close);
assert.equal(a.current.ma20,b.current.ma20);
assert.equal(b.partialExcluded,true);
assert.equal(T.analyze([]).available,false);
assert.equal(T.analyze(bars.slice(0,10)).current.rsi,null);
assert.equal(T.analyze(bars.slice(0,20)).drawdown60,null);
console.log('Technical reference and boundary checks passed.');
