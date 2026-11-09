/* Cold lifecycle and forecast workloads: previous source and fixed pre-Rust source are independent. */
const fs=require('node:fs'),path=require('node:path'),v8=require('node:v8'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),os=require('node:os');
const baseline=process.env.RAIL_JS_BASELINE,previous=process.env.RAIL_PREVIOUS_ROOT,root=path.resolve(__dirname,'..');
if(['javascript','previous','current'].includes(process.argv[2])){
 const mode=process.argv[2],kind=process.argv[3],bundle=v8.deserialize(fs.readFileSync(process.argv[4])),source=mode==='javascript'?baseline:mode==='previous'?previous:root;
 const load=name=>require(path.join(source,'rail',name));
 let samples=[],cpu=[],state;
 const measure=fn=>{global.gc?.();const c=process.cpuUsage(),start=performance.now(),result=fn();samples.push(performance.now()-start);const d=process.cpuUsage(c);cpu.push((d.user+d.system)/1000);return result;};
 if(kind==='urban'){
  const U=load('urban-growth'),C=load('city'),s=bundle.s,base=C.create(s.region);for(let i=0;i<2;i++)U.step(s,base);
  for(let i=0;i<8;i++)measure(()=>U.step(s,base));state={urban:s.urban,city:U.city(s,base)};
 }else if(kind==='migration'){
  const P=load('passengers'),M=load('management'),N=load('network');
  for(let i=0;i<6;i++){const s=structuredClone(bundle.s),rt=P.create(s,bundle.f,480,false);M.advance(s,rt,30);N.removeStation(s,s.services[0].id,s.services[0].stops[1]);measure(()=>P.reconcile(rt,s));state={state:s,snapshot:P.snapshot(rt),defs:rt.defs};}
 }else if(kind==='forecast'){
  const D=load('demand-model'),P=load('passengers');let forecast;
  for(let i=0;i<Number(process.env.RAIL_FORECAST_SAMPLES||3);i++)forecast=measure(()=>D.evaluate(bundle.s,bundle.city,mode==='current'?{compact:true}:{}));
  global.gc?.();const retained=process.memoryUsage().heapUsed/1048576,arrayBuffers=process.memoryUsage().arrayBuffers/1048576,core=mode==='javascript'?null:load('routing-wasm').status(),status=mode==='current'?load('forecast-catalog').status(forecast):null;
  const flows=Array.from(forecast.flows),defs=forecast.preparedDefinitions?Array.from(forecast.preparedDefinitions):P.definitions(bundle.s,forecast);
  const clean=f=>({from:f.from,to:f.to,purpose:f.purpose,back:f.back,trips:f.trips,demandTrips:f.demandTrips,population:f.population,walk:f.walk,rail:f.rail,road:f.road,hub:f.hub,externalKind:f.externalKind,routeOptions:f.routeOptions,path:{service:f.path.service,dir:f.path.dir,lastLine:f.path.lastLine,fareKm:f.path.fareKm,board:f.path.board,cost:f.path.cost,minutes:f.path.minutes,fare:f.path.fare,km:f.path.km,edges:f.path.edges,transfers:f.path.transfers,fares:f.path.fares}});
  state={flows:flows.map(clean),defs,trackFlow:forecast.trackFlow,trackLoad:forecast.trackLoad,serviceFlow:forecast.serviceFlow,lineConnections:forecast.lineConnections};
  fs.writeFileSync(process.argv[5],v8.serialize(state));console.log(JSON.stringify({mode,kind,samplesMs:samples,cpuMs:cpu,retainedHeapMiB:retained,arrayBuffersMiB:arrayBuffers,peakRssMiB:process.resourceUsage().maxRSS/1024,wasmMiB:(core?.memoryBytes||0)/1048576,catalog:status,profiles:flows.length}));process.exit(0);
 }
 global.gc?.();fs.writeFileSync(process.argv[5],v8.serialize(state));const core=mode==='javascript'?null:load('routing-wasm').status();console.log(JSON.stringify({mode,kind,samplesMs:samples,cpuMs:cpu,retainedHeapMiB:process.memoryUsage().heapUsed/1048576,arrayBuffersMiB:process.memoryUsage().arrayBuffers/1048576,peakRssMiB:process.resourceUsage().maxRSS/1024,wasmMiB:(core?.memoryBytes||0)/1048576}));
}else{
 assert(baseline&&previous,'set RAIL_JS_BASELINE and RAIL_PREVIOUS_ROOT');assert.equal(spawnSync('git',['-C',baseline,'rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),'498c5cd2af607e60dd1c75a8ba5863c08ac5d4fa');
 const kind=process.argv[2]||'urban',large=process.argv[3]==='large',size=large?7:5,{create}=require('./fixtures/rail-memory-grid.cjs'),D=require('../rail/demand-model');let bundle;
 if(kind==='urban'){
  const U=require('../rail/urban-growth'),C=require('../rail/city'),Names=require('../rail/place-names'),N=require('../rail/network'),M=require('../rail/management');const s=M.init(N.emptyWorld('gba')),base=C.create('gba');U.init(s);if(large){U.enableAutomatic(s,base,Names.places('gba'));U.enableDevelopment(s,base,Names.places('gba'));}else{const p=Names.places('gba').find(p=>U.buildable(s,base,p));U.plan(s,base,'school',p);N.addLine(s,[{x:p.x-30,y:p.y},{x:p.x,y:p.y},{x:p.x+30,y:p.y}],{stockSpec:'6B'});}bundle={s};
 }else{
  const s=create(kind==='migration'?3:size),fields=['people','jobs','shops','industry','leisure'],cells=s.nodes.map((n,i)=>({id:'c'+i,x:n.x,y:n.y,w:8,h:8,area:.13,people:3000+i*200,jobs:1500+i*100,shops:500,industry:50,leisure:200})),city={cells,totals:Object.fromEntries(fields.map(k=>[k,cells.reduce((v,c)=>v+c[k],0)])),metadata:{effectiveConnections:true,demandZoneUnits:40}};bundle={s,city,f:kind==='migration'?D.evaluate(s,city):null};
 }
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rail-p1-cold-'));try{const input=path.join(temp,'input.bin');fs.writeFileSync(input,v8.serialize(bundle));const results=[];let expected;
 for(let round=0;round<2;round++)for(const mode of round?['current','previous','javascript']:['javascript','previous','current']){const out=path.join(temp,'state.bin'),r=spawnSync(process.execPath,['--expose-gc',__filename,mode,kind,input,out],{encoding:'utf8',timeout:240000});if(r.status!==0)throw Error(r.stderr||r.stdout||r.error?.message||String(r.signal));const state=v8.deserialize(fs.readFileSync(out));if(expected)assert.deepEqual(state,expected,'full cold transaction/forecast result');else expected=state;results.push({...JSON.parse(r.stdout),round});}
 const median=a=>{a.sort((x,y)=>x-y);return(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};console.log(JSON.stringify({kind,size:large?'large':'small',baselineCommit:'498c5cd2af607e60dd1c75a8ba5863c08ac5d4fa',method:'independent sources/processes, reversed second round; exact complete cold state or specified complete forecast fields; GC outside measurements',summary:['javascript','previous','current'].map(mode=>{const rows=results.filter(r=>r.mode===mode);return{mode,medianMs:median(rows.flatMap(r=>r.samplesMs)),medianCpuMs:median(rows.flatMap(r=>r.cpuMs)),retainedHeapMiB:median(rows.map(r=>r.retainedHeapMiB)),peakRssMiB:Math.max(...rows.map(r=>r.peakRssMiB)),arrayBuffersMiB:median(rows.map(r=>r.arrayBuffersMiB)),wasmMiB:rows[0].wasmMiB,catalog:rows[0].catalog,profiles:rows[0].profiles};}),results},null,2));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
