/* Cold metadata must not rescan/retransmit sampling or return native-only arrival events. */
const assert=require('node:assert/strict');
const P=require('../rail/passengers'),M=require('../rail/management'),Core=require('../rail/routing-wasm');
const {create}=require('./fixtures/rail-memory-grid.cjs');
const s=create(2),line=s.services[0];let reads=0;
const catalog=Array.from({length:2600},(_,id)=>({id,legs:[{service:line.id,dir:1,from:line.stops[0],to:line.stops.at(-1)}],
  get daily(){reads++;return 20;},fare:180+id,purpose:'work',back:false,hub:null,externalKind:null,
  from:line.stops[0],to:line.stops.at(-1),lineIds:[line.id],byLine:{[line.id]:1}}));
const rt=P.create(s,{preparedDefinitions:catalog},480,false);rt.arrivalMode='weighted';
M.advance(s,rt,.1);reads=0;
const kernel=Core.kernel,frames=[];
Core.kernel=function(name,input,...rest) {
  const result=kernel(name,input,...rest);
  if(name==='engine_cycle'&&input[15]) {
    frames.push({preparation:input[10],status:result[1],inputBytes:input.byteLength,result:result.slice()});
  }
  return result;
};
try{M.advance(s,rt,.9);}finally{Core.kernel=kernel;}
assert.equal(reads,catalog.length,'one daily scan, regardless of metadata continuation count');
assert(frames.length>=3);
assert(frames[0].preparation>0);
assert(frames.slice(1).every(f=>f.preparation===0),'pending native preparation must be reused');
const final=frames.at(-1).result;assert.equal(final[1],0);
const at=11+final[3]+final[4]*2+final[5]*3;
assert.equal(final[at+2],4,'only arrival summary returns to JS');
assert.equal(final[at+final[8]],2,'compact motion protocol');
assert(rt.generated>0,'native events still admit/reject actual passengers');
assert(Core.status().arrivalValuesOmitted>=catalog.length*2);
const status=Core.status();assert(status.projectionSentValues<status.projectionFullValues);
const summary=P.summary(rt);
assert(Math.abs(summary.generated-summary.waiting-summary.onboard-summary.completed-summary.cancelled)<1e-6);
console.log(JSON.stringify({test:'MAP52 transport',metadataCalls:frames.length,dailyReads:reads,
  pendingPreparationValues:frames.slice(1).map(f=>f.preparation),motionValues:[status.projectionFullValues,status.projectionSentValues],
  arrivalValuesOmitted:status.arrivalValuesOmitted}));
