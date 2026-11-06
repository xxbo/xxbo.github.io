/* Exact MAP42 to MAP43 gate: one native forecast, no JS per-group decisions. */
const assert=require('node:assert/strict');
const D=require('../rail/demand-model'),Old=require('./fixtures/rail-map42-demand.cjs');
const K=require('../rail/connection-model'),OK=require('./fixtures/rail-map42-connections.cjs');
const H=require('../rail/hubs'),OH=require('./fixtures/rail-map42-hubs.cjs');
const Core=require('../rail/routing-wasm'),N=require('../rail/network'),M=require('../rail/management'),F=require('../rail/fleet');
const {create}=require('./fixtures/rail-memory-grid.cjs');
const fields=['people','jobs','shops','industry','leisure'];
const clean=v=>JSON.parse(JSON.stringify(v,(k,x)=>['memory','calculationMs'].includes(k)?undefined:x));
function cityAt(s,effective=true,multiplier=1){
 const cells=s.nodes.flatMap((p,i)=>[0,1].map(j=>({id:'c'+i+'-'+j,x:p.x+j*8,y:p.y+j*9,w:14,h:10,area:.2,
 people:(1200+i*130)*multiplier,jobs:(700+i*230)*multiplier,shops:(400+i*50)*multiplier,industry:100*multiplier,leisure:300*multiplier,
 factory:13,survey:.8,populationValid:i%2===0})));
 return {cells,totals:Object.fromEntries(fields.map(k=>[k,cells.reduce((v,c)=>v+c[k],0)])),metadata:{effectiveConnections:effective,demandZoneUnits:40}};
}
let forecasts=0,spatial=0;
function compare(s,c){
 const before=Core.status(), actual=D.evaluate(s,c),after=Core.status();
 assert.equal(after.forecastCalls-before.forecastCalls,1);
 assert.equal(after.demandCalls-before.demandCalls,1,'one demand boundary per complete forecast');
 const expected=Old.evaluate(s,c);
 assert.deepEqual(clean(actual),clean(expected));
 if(s.services.length){
  assert.deepEqual(actual.diagnostics.memory.routeTrees,expected.diagnostics.memory.routeTrees);
  assert.deepEqual(actual.diagnostics.memory.strategies,expected.diagnostics.memory.strategies);
 }
 assert.deepEqual(D.assign(s,c),Old.assign(s,c));spatial++;
 assert.deepEqual(D.distribution(c),Old.distribution(c));spatial++;
 for(const p of s.nodes.slice(0,3)){
  assert.deepEqual(D.local(c,p),Old.local(c,p));
  for(const feeders of [false,true])assert.deepEqual(D.choices(p,s.nodes,feeders),Old.choices(p,s.nodes,feeders));
  spatial+=3;
 }
 forecasts++;return actual;
}
for(const region of ['tokyo','gba']){
 const hub=H.forRegion(region).find(h=>h.type==='airport');
 for(const effective of [false,true])for(const version of [0,19,36]){
  const s=create(3);s.region=region;
  // Shift a multi-line network to an actual hub, preserving all station geometry.
  const dx=hub.x-s.nodes[0].x,dy=hub.y-s.nodes[0].y;
  for(const n of s.nodes){n.x+=dx;n.y+=dy;}
  if(version)s.urban={version,step:version===19?0:140};else delete s.urban;
  const c=cityAt(s,effective),a=compare(s,c);
  assert(a.hubStats[hub.id].connections.length>0);
  if(version!==19)assert(a.hubStats[hub.id].riders>0);
 }
 const empty=M.init(N.upgrade(N.emptyWorld(region)));compare(empty,cityAt(empty));
}
// Loop, short turns, fast/direct runs and cross-line services all use native group assignment.
const ring=M.init(N.upgrade(N.emptyWorld('tokyo')));
const points=[{x:1100,y:900},{x:1180,y:900},{x:1180,y:980},{x:1100,y:980},{x:1100,y:900}];
assert(!N.addLine(ring,points,{stockSpec:'6B'}).error);assert(!F.purchase(ring,'6B',30).error);
const l=ring.services[0];
assert(!N.configure(ring,l.id,{dispatch:{mode:'manual',manual:8,offPeak:8,peak:8}}).error);
compare(ring,cityAt(ring));
const many=create(4);for(const l of many.services)l.patterns=[{kind:'local',from:0,to:l.stops.length-1,fleet:4},{kind:'direct',from:0,to:l.stops.length-1,fleet:4}];
compare(many,cityAt(many,true,5));
// Empty fleets and density gaps.
const zero=create(3);for(const l of zero.services)N.configure(zero,l.id,{dispatch:{mode:'manual',manual:0,offPeak:0,peak:0}});compare(zero,cityAt(zero));
const edge=create(2),ec=cityAt(edge);ec.cells.push({...ec.cells[0],id:'far',x:-5000,y:-5000});for(const k of fields)ec.totals[k]+=ec.cells.at(-1)[k];compare(edge,ec);
// Frozen policies: public wrappers preserve mutation and callback order.
for(let i=0;i<100;i++){
 const c=cityAt(edge,i%2===0,i);
 assert.deepEqual(K.budgets(c),OK.budgets(c));assert.deepEqual(K.visitorBudget(c,i*1e5),OK.visitorBudget(c,i*1e5));
 const ma=new Float64Array([i,4*i,2*i,3*i]),mb=ma.slice(),rows=[i*.2,i*1.2];
 assert.strictEqual(K.capRows(ma,rows,2),ma);OK.capRows(mb,rows,2);assert.deepEqual(ma,mb);
 const a=[{staffTrips:[i,i*2],local:[i*3,i*4]},{staffTrips:[i*5,i],local:[i,i*2]}],b=structuredClone(a),z=[{people:100},{people:20}];
 K.reserveExternal(a,z,(a,j)=>j===i%2);OK.reserveExternal(b,z,(a,j)=>j===i%2);assert.deepEqual(a,b);
 for(const h of [H.forRegion('tokyo')[0],H.forRegion('gba')[0]])for(const kind of ['staff-outbound','visitor-return']){
  const args={minutes:i*2,access:i/3,fare:i*20,km:i/2};assert.equal(H.share(h,args,kind),OH.share(h,args,kind));
 }
}
// Owned projections survive instance replacement and traps; retained matrices keep their cells.
const bytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'../rail/wasm/rail-core-v4.wasm'));
Core.create(bytes,{recycleBytes:0});
const c=cityAt(edge),owned=D.distribution(c),snapshot=clean(owned),forecast=compare(edge,c),copy=clean(forecast);
assert.throws(()=>Core.kernel('world_run',[0]),/Rust\/WASM/);
compare(edge,cityAt(edge));assert.deepEqual(clean(owned),snapshot);assert.deepEqual(clean(forecast),copy);
Core.create(bytes,{recycleBytes:64*1024*1024});
console.log(`MAP43 passed: ${forecasts} exact whole forecasts, ${spatial} spatial comparisons, hub/city growth, loop/direct services, exact LRU stats, policy parity, one forecast crossing and owned output/trap recovery.`);
