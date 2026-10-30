const assert=require('node:assert/strict'),N=require('../rail/network'),C=require('../rail/city'),D=require('../rail/demand-model'),P=require('../rail/passengers'),R=require('../rail/engine');
const near=(a,b,t=1e-6)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
// Preserve exposure strata until mode choice; adding remote feeder catchments must not
// make the same walking residents adopt the remote average access cost.
const sample={x:1200,y:900},options=D.choices(sample,[{id:0,x:1200,y:900},{id:1,x:1250,y:900}]);near(options.reduce((v,a)=>v+a.share,0),1);assert.equal(D.choices(sample,[{id:0,x:1250,y:900}])[0].share,1);
const short=N.emptyWorld();N.addLine(short,[{x:1168,y:920},{x:1202,y:934},{x:1230,y:948}]);const model=C.evaluate(short),catchment=model.catchment;near(catchment.covered,37596,.001);assert(model.riders>100&&model.riders<model.diagnostics.connectedDemand);assert(model.diagnostics.connectedDemand>0);assert([...catchment.mapping.values()].some(c=>new Set(c.access.map(a=>Math.floor(a.time/3))).size>1));
// A useful corridor should produce actual arrivals in the first peak hour, not 0.02 per token.
const rt=P.create(short,model,420,false);P.advance(rt,short,60);const x=P.summary(rt);assert(x.generated>=5);assert(rt.boarded>0&&x.completed>0);for(const q of Object.values(rt.queues))for(const count of Object.values(q))assert(Number.isInteger(count));for(const t of rt.trains)assert(Number.isInteger(t.onboard));near(x.generated,x.waiting+x.onboard+x.completed+x.cancelled);assert(rt.expectedGenerated-x.generated>=-1e-8&&rt.expectedGenerated-x.generated<1+1e-8);
// Many individually sub-person OD streams must be accumulated globally instead of each
// stream waiting days to reach one passenger. No multiplier: total arrival error < 1.
const route=model.flows[0],tiny={flows:Array.from({length:1500},()=>({...route,trips:.2,demandTrips:.2}))},small=P.create(short,tiny,420,false);P.advance(small,short,60);assert(small.generated>1);near(small.expectedGenerated-small.generated,small.arrivalRemainder);assert(small.arrivalRemainder>=0&&small.arrivalRemainder<1);
const saved=JSON.parse(JSON.stringify(P.snapshot(small))),restore=P.restore(short,tiny,saved);assert(restore);P.advance(small,short,40);P.advance(restore,short,40);assert.equal(small.generated,restore.generated);assert.equal(small.rngState,restore.rngState);near(P.summary(small).waiting,P.summary(restore).waiting);
const expensive=R.clone(short);N.configure(expensive,expensive.services[0].id,{fareBands:[2000,2100,2200,2300,2400,2500]});assert(C.evaluate(expensive).riders<model.riders);
// Unavailable modes do not silently compete as options everyone owns.
const trip={purpose:'work',minutes:12,access:8,fare:180,km:7};assert(D.modeShare({...trip,availability:{car:0,bike:0}})>D.modeShare(trip));near(D.modeShare({...trip,availability:{walk:0,bike:0,car:0,bus:0}}),1);assert.equal(D.modeShare({...trip,availability:{rail:0}}),0);
const empty=C.evaluate(N.emptyWorld());assert.equal(empty.riders,0);const no=P.create(N.emptyWorld(),empty,420,false);P.advance(no,N.emptyWorld(),60);assert.equal(no.generated,0);
console.log('MAP13 passed: stratified access, no duplicate feeder haircut, demand-stage diagnostics, nonzero useful-line arrivals, integer passengers, sub-person OD accumulation, expected-count conservation, deterministic restore and fare/mode availability sensitivity.');
