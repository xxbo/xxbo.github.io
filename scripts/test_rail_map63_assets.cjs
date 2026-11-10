/* P2-2 full state, accounting, native command boundaries and failure atomicity. */
const assert=require('node:assert/strict'),R=require('../rail/engine'),N=require('../rail/network'),M=require('../rail/management'),F=require('../rail/fleet'),U=require('../rail/urban-growth'),C=require('../rail/city'),Names=require('../rail/place-names'),A=require('../rail/assets-wasm'),Core=require('../rail/routing-wasm');
const OldM=require('./fixtures/rail-map62-management.cjs'),OldF=require('./fixtures/rail-map62-fleet.cjs'),OldU=require('./fixtures/rail-map62-urban-growth.cjs');
const clone=structuredClone;let checks=0;
function exact(a,b,label){assert.deepEqual(a,b,label);assert.equal(JSON.stringify(a),JSON.stringify(b),label+' field order');checks++;}
function seed(fn){const old=Math.random;Math.random=()=>.31415926535;try{return fn();}finally{Math.random=old;}}
function compare(s,oldOp,newOp,label,method='change'){
 const a=clone(s),b=clone(s);const x=seed(()=>OldM[method](a,oldOp)),y=seed(()=>M[method](b,newOp));exact(y,x,label+' return');exact(b,a,label+' state');return b;
}
const points=(y=500)=>[{x:600,y,nameSeed:.1},{x:640,y,nameSeed:.2},{x:680,y,nameSeed:.3}];
for(const region of ['tokyo','gba']){
 let s=N.emptyWorld(region),old=clone(s);compare(s,c=>N.addLine(c,points(),{stockSpec:'6B'}),M.command('network','addLine',{points:points(),options:{stockSpec:'6B'}}),'uninitialized free preview','preview');exact(M.init(s),OldM.init(old),'initial accounts '+region);
 for(const minute of [420,1440,1999]){
  const a=clone(s),b=clone(s);a.economy.balanceVersion=b.economy.balanceVersion=16;a.economy.minute=b.economy.minute=minute;
  delete a.economy.operatingGrant;delete b.economy.operatingGrant;
  exact(M.init(a),OldM.init(b),'cost upgrade '+region+'/'+minute);const before=JSON.stringify(a);M.init(a);assert.equal(JSON.stringify(a),before);
 }
 for(const method of ['preview','change'])compare(s,c=>N.addLine(c,points(),{stockSpec:'6B'}),M.command('network','addLine',{points:points(),options:{stockSpec:'6B'}}),'managed line '+region,method);
 s=compare(s,c=>N.addLine(c,points(),{stockSpec:'6B'}),M.command('network','addLine',{points:points(),options:{stockSpec:'6B'}}),'add line '+region);
 for(const spec of Object.keys(F.SPECS))for(const count of [1,2,8,80]){
  compare(s,c=>OldF.purchase(c,spec,count),M.command('fleet','purchase',{spec,count}),'purchase '+region+spec+count);
  const a=clone(s),b=clone(s);exact(F.purchase(a,spec,count),OldF.purchase(b,spec,count),'direct purchase');exact(a,b,'direct depot');exact(F.value(a),OldF.value(b),'vehicle value');
 }
 s=compare(s,c=>OldF.purchase(c,'6B',12),M.command('fleet','purchase',{spec:'6B',count:12}),'stock');const id=s.services[0].id;
 for(const dispatch of [{mode:'manual',manual:4,offPeak:4,peak:6},{mode:'auto',manual:0,offPeak:4,peak:12}]){
  s=compare(s,c=>N.configure(c,id,{dispatch}),M.command('network','configure',{id,values:{dispatch}}),'reserve '+region);
 }
 for(const spec of Object.keys(F.SPECS))for(const except of [undefined,id,'unknown']){
  exact(F.reserved(s,spec,except),OldF.reserved(s,spec,except),'reserved');exact(F.free(s,spec,except),OldF.free(s,spec,except),'free');
 }
 for(const daily of [0,1,10000,1e6,-1])exact(F.recommend(s,s.services[0],daily),OldF.recommend(s,s.services[0],daily),'recommend');
 exact(F.validate(s),OldF.validate(s),'fleet validation');exact(M.validate(s),OldM.validate(s),'account validation');
 for(const spec of ['bad','6B'])for(const count of [0,-1,1.5,81,NaN,Infinity]){
  const a=clone(s),before=JSON.stringify(a);assert(M.change(a,M.command('fleet','purchase',{spec,count})).error);assert.equal(JSON.stringify(a),before);checks++;
 }
 const bad=clone(s);bad.depot.stock['6B']=2400;const before=JSON.stringify(bad);assert(M.change(bad,M.command('fleet','purchase',{spec:'6B',count:1})).error);assert.equal(JSON.stringify(bad),before);
 for(const values of [{cars:8},{stockSpec:'8A'},{dispatch:{mode:'manual',manual:14,offPeak:0,peak:0}},{dispatch:{mode:'auto',manual:0,offPeak:8,peak:4}},{patterns:[{kind:'local',from:0,to:2},{kind:'express',from:0,to:2,calls:[0,2]}],dispatch:{mode:'manual',manual:2,offPeak:0,peak:0}}]){
  const a=clone(s),snapshot=JSON.stringify(a);assert(M.change(a,M.command('network','configure',{id,values})).error);assert.equal(JSON.stringify(a),snapshot);checks++;
 }
 const poor=clone(s);poor.economy.cash=0;compare(poor,c=>OldF.purchase(c,'8A',2),M.command('fleet','purchase',{spec:'8A',count:2}),'insufficient purchase');
 compare(s,c=>N.removeLine(c,id),c=>N.removeLine(c,id),'callback delete source-index projection');
 compare(s,c=>N.addStation(c,id,{x:620,y:505,nameSeed:.2},{index:1}),c=>N.addStation(c,id,{x:620,y:505,nameSeed:.2},{index:1}),'callback insert source-index projection');
 s=compare(s,c=>N.removeLine(c,id),M.command('network','removeLine',{id}),'line recovery');assert.equal(s.depot.stock['6B'],12);
 const base=C.create(region),p=Names.places(region).find(p=>U.buildable(s,base,p));
 for(const kind of Object.keys(U.TYPES)){
  let city=clone(s);U.init(city);
  for(const method of ['preview','change'])compare(city,c=>OldU.plan(c,base,kind,p),M.command('facility','plan',{kind,point:p,land:true}),'facility plan '+kind,method);
  city=compare(city,c=>OldU.plan(c,base,kind,p),M.command('facility','plan',{kind,point:p,land:true}),'facility buy '+kind);
  const fid=city.urban.facilities[0].id;
  for(let level=1;level<3;level++)city=compare(city,c=>OldU.upgrade(c,fid),M.command('facility','upgrade',{id:fid}),'facility upgrade');
  compare(city,c=>OldU.upgrade(c,fid),M.command('facility','upgrade',{id:fid}),'max level');
  compare(city,c=>OldU.remove(c,fid),M.command('facility','remove',{id:fid}),'facility salvage');
  exact(U.facilitiesValue(city),OldU.facilitiesValue(city),'facility value');
  for(const command of [M.command('facility','plan',{kind,point:p,land:true}),M.command('facility','plan',{kind,point:{x:1,y:1},land:true}),M.command('facility','plan',{kind,point:p,land:false})]){
   const a=clone(city),snap=JSON.stringify(a);assert(M.change(a,command).error);assert.equal(JSON.stringify(a),snap);checks++;
  }
  city.urban.facilityMode='automatic';for(const op of ['plan','upgrade','remove']){const snap=JSON.stringify(city);assert(M.change(city,M.command('facility',op,{id:fid,kind,point:p,land:true})).error);assert.equal(JSON.stringify(city),snap);checks++;}
 }
 // Full depot validity rejects oversubscribed compatibility callbacks and nonfinite assets before applying cash.
 for(const action of [c=>{c.depot.stock['6B']=-1;return {};},c=>{c.tracks.push({id:'invalid',km:NaN});return {}; }]){
  const a=clone(s),snap=JSON.stringify(a);assert(M.change(a,action).error);assert.equal(JSON.stringify(a),snap);checks++;
 }
 // Every preview and actual user command crosses one native boundary for editing, quoting and cash.
 const beforeCalls=Core.status(),a=clone(s),out=M.preview(a,M.command('network','addLine',{points:points(700),options:{stockSpec:'8A'}})),afterCalls=Core.status();assert(!out.error);
 assert.equal(afterCalls.coldCalls-beforeCalls.coldCalls,1);assert.equal(afterCalls.editorCalls-beforeCalls.editorCalls,0);assert.equal(JSON.stringify(a),JSON.stringify(s));checks++;
 const mark=Core.status();assert(!M.change(a,M.command('network','addLine',{points:points(700),options:{stockSpec:'8A'}})).error);assert.equal(Core.status().coldCalls-mark.coldCalls,1);assert.equal(Core.status().editorCalls-mark.editorCalls,0);checks++;
 // Force WASM recycling and repeat asset rules with reloaded configuration.
 const saved=Core.status();Core.recycleSimulation();assert.equal(Core.status().recycles,saved.recycles+1);exact(A.query(s,'vehicleValue'),OldF.value(s),'post recycle value');
}
// Asset valuation cache follows exact mutable price inputs, including in-place facility edits.
const values={urban:{facilities:[{kind:'school',level:1}]}};
for(const edit of [()=>{},()=>{values.urban.facilities[0].level=2;},()=>{values.urban.facilities[0].system=true;},()=>{values.urban.facilities[0].system=false;values.urban.facilities[0].kind='hospital';},()=>{values.urban.facilities=[];}]){
 edit();exact(U.facilitiesValue(values),OldU.facilitiesValue(values),'mutable facility cache');const calls=Core.status().coldCalls;U.facilitiesValue(values);assert.equal(Core.status().coldCalls,calls);
}
// Mixed historical managed/unmanaged records reserve only managed lines, as the public depot API specifies.
const mixed={depot:{stock:{'6B':12}},services:[{id:'a',fleetManaged:true,stockSpec:'6B',fleet:4},{id:'b',stockSpec:'6B',fleet:8}]};exact(F.reserved(mixed,'6B'),4,'managed reservation filter');
const line={fleetManaged:true,stockSpec:'6B',cars:6,fleet:4,dispatch:{mode:'manual',manual:4,offPeak:4,peak:4},patterns:[{},{}]},snap=JSON.stringify(line);assert(F.configure(line,{mode:'manual',manual:2,offPeak:2,peak:2}).error);assert.equal(JSON.stringify(line),snap);
console.log(`MAP63 P2-2: ${checks} complete MAP62 comparisons and asset invariants passed; native construction/stock/facility transactions, quotes/ledger/salvage, preview, rollback and one-call command boundaries.`);
