const assert=require('node:assert/strict'),N=require('../rail/network'),C=require('../rail/city'),D=require('../rail/demand-model'),P=require('../rail/passengers'),Q=require('../rail/ridership'),R=require('../rail/engine');
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);
// Actual WorldPop grid, eight stations across central Tokyo, not injected passenger demand.
const s=N.emptyWorld();Q.init(s);N.addLine(s,Array.from({length:8},(_,i)=>({x:1180+i*20,y:924.5})));Q.sync(s);
const m=C.evaluate(s);assert(m.riders>10000&&m.riders<60000);assert(m.riders<m.diagnostics.connectedDemand);
assert(m.flows.every(f=>Number.isFinite(f.trips)&&f.trips>=0));
const st=N.stats(s,m,s.services[0].id);assert(Object.values(st.stations).every(a=>a.board>500));
// Generalized access cost follows the mode actually used; elapsed minutes remain separate.
for(const [mode,x]of [['walk',0],['bike',25],['bus',65]]){const a=D.choices({x:1000,y:900},[{id:0,x:1000+x,y:900}])[0];assert.equal(a.mode,mode);near(a.accessCost,a.time*D.ACCESS_WEIGHTS[mode]);}
const trip={purpose:'work',minutes:15,access:20,fare:180,km:6};assert(D.modeShare({...trip,accessCost:22})>D.modeShare({...trip,accessCost:34}));
const costly=R.clone(s);N.configure(costly,costly.services[0].id,{fareBands:[2000,2100,2200,2300,2400,2500]});assert(C.evaluate(costly).riders<m.riders*.5);
const rural=N.emptyWorld();N.addLine(rural,[{x:300,y:200},{x:320,y:200}]);assert(C.evaluate(rural).riders<m.riders*.1);assert.equal(C.evaluate(N.emptyWorld()).riders,0);
const rt=P.create(s,m,420,false);P.advance(rt,s,120);const actual=P.summary(rt),daily=s.ridership.current.stations;
assert(actual.generated>1000&&actual.completed>500);
near(actual.generated,actual.completed+actual.cancelled+actual.waiting+actual.onboard);
near(Object.values(daily).reduce((v,a)=>v+a.boarded,0),rt.boarded);
near(Object.values(daily).reduce((v,a)=>v+a.alighted,0),rt.alighted);
assert(Object.values(daily).some(a=>a.entered>100));
assert(Object.keys(daily).some(id=>P.station(rt,+id).today.entered>P.station(rt,+id).waiting));
// Same run continues deterministically after reload, including actual daily counters.
const copy=R.clone(s),restored=P.restore(copy,m,JSON.parse(JSON.stringify(P.snapshot(rt))));assert(restored);P.advance(rt,s,20);P.advance(restored,copy,20);assert.deepEqual(copy.ridership.current.stations,s.ridership.current.stations);
const oldBest=s.ridership.records.totalCompleted;P.advance(rt,s,1320);assert.equal(s.ridership.current.number,2);assert(s.ridership.records.totalCompleted>oldBest);assert(s.ridership.history[0].stations);assert.equal(Q.station(s,0,rt.minute).entered,s.ridership.current.stations[0]?.entered||0);
console.log('MAP15 passed: real-grid urban/rural demand scale, mode-specific access costs, fare sensitivity, actual peak arrivals, per-station daily counters, day rollover, deterministic save and passenger conservation.');
console.log(JSON.stringify({matureDailyJourneys:m.riders,stationDailyBoardings:Object.values(st.stations).map(a=>Math.round(a.board)),openingPeak120min:actual}));
