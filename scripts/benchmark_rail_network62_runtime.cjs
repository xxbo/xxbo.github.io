/* Absolute runtime baseline: MAP40 is the parent of the first Rust migration. No browser/FPS claim. */
const fs=require('node:fs'),path=require('node:path'),v8=require('node:v8'),crypto=require('node:crypto'),os=require('node:os');
const {spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const BASELINE='498c5cd2af607e60dd1c75a8ba5863c08ac5d4fa';
const modes=['javascript','previous-worker','rust-sync','rust-worker'];
if(modes.includes(process.argv[2])) {
 const mode=process.argv[2],inputPath=process.argv[3],statePath=process.argv[4],baselineRoot=process.argv[5];
 let traffic={requests:0,inputBytes:0,outputBytes:0};
 if(mode.endsWith('worker')){
  const threads=require('node:worker_threads'),Base=threads.Worker;
  threads.Worker=class extends Base{
   constructor(...args){super(...args);this.on('message',m=>{traffic.outputBytes+=m.result?.byteLength||0;});}
   postMessage(m,...args){traffic.requests++;traffic.inputBytes+=(m.input?.byteLength||0)+(m.bytes?.byteLength||0);return super.postMessage(m,...args);}
  };
 }
 const root=mode==='javascript'?baselineRoot:mode==='previous-worker'?process.env.RAIL_PREVIOUS_ROOT:path.resolve(__dirname,'..');
 const P=require(path.join(root,'rail/passengers')),M=require(path.join(root,'rail/management'));
 const Core=mode==='javascript'?null:require(path.join(root,'rail/routing-wasm'));
 (async()=>{
  const bundle=v8.deserialize(fs.readFileSync(inputPath)),s=bundle.s,f=mode==='javascript'?bundle.f:require(path.join(root,'rail/forecast-catalog')).hydrate(bundle.compact),rt=P.create(s,f,480,false);s.economy.minute=480;
  const worker=mode.endsWith('worker');if(worker)P.nativeViews(rt);
  const advance=minutes=>worker?M.advanceBudgetAsync(s,rt,minutes,{budget:1e6,maxSteps:10000,now:()=>0}):M.advance(s,rt,minutes);
  try{
   await advance(30);traffic={requests:0,inputBytes:0,outputBytes:0};global.gc?.();
   const samplesMs=[],cpuMicros=[],heapMiB=[],eventLoopMaxMs=[];
   for(let i=0;i<5;i++){
    await new Promise(resolve=>setTimeout(resolve,2));
    let expectedTick=performance.now()+1,maxLag=0;
    const probe=setInterval(()=>{const now=performance.now();maxLag=Math.max(maxLag,now-expectedTick);expectedTick=now+1;},1);
    const cpu=process.cpuUsage(),start=performance.now();await advance(30);samplesMs.push(performance.now()-start);
    const used=process.cpuUsage(cpu);cpuMicros.push(used.user+used.system);
    await new Promise(resolve=>setTimeout(resolve,2));clearInterval(probe);eventLoopMaxMs.push(maxLag);
    global.gc?.();heapMiB.push(process.memoryUsage().heapUsed/1048576);
   }
   const measuredTraffic={...traffic},core=Core?.status();
   const snapshot=worker?await P.snapshotAsync(rt):P.snapshot(rt),state={state:s,snapshot};
   fs.writeFileSync(statePath,v8.serialize(state));
   if(mode==='javascript')assert(!Object.keys(require.cache).some(k=>k.includes('routing-wasm')), 'JS baseline must not load Rust adapters');
   const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
   const ordered=[...samplesMs].sort((a,b)=>a-b);
   console.log(JSON.stringify({mode,lines:s.services.length,stations:s.nodes.length,samplesMs,medianMs:ordered[2],cpuMicros,heapMiB,eventLoopMaxMs,
    peakRssMiB:process.resourceUsage().maxRSS/1024,wasmMiB:(core?.memoryBytes||0)/1048576,...measuredTraffic,
    generated:rt.generated,completed:rt.completed,checksum:crypto.createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex')}));
  }finally{P.dispose?.(rt);}
 })().catch(e=>{console.error(e);process.exitCode=1;});
}else{
 const baselineRoot=process.env.RAIL_JS_BASELINE;
 if(!baselineRoot)throw Error(`Set RAIL_JS_BASELINE to a clean checkout of ${BASELINE}; see rail/rust-wasm-map56.md`);
 const head=spawnSync('git',['-C',baselineRoot,'rev-parse','HEAD'],{encoding:'utf8'});
 assert.equal(head.stdout.trim(),BASELINE,'pin the exact pre-Rust commit');
 const dirty=spawnSync('git',['-C',baselineRoot,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'});assert.equal(dirty.stdout.trim(),'','baseline tracked files must be clean');
 if(!process.env.RAIL_PREVIOUS_ROOT)throw Error('Set RAIL_PREVIOUS_ROOT to the verified MAP61 tree');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rail-cumulative-'));
 try{
  const {create}=require('./fixtures/rail-memory-grid.cjs'),D=require('../rail/demand-model');
  const s=create(Number(process.argv[2])||5),fields=['people','jobs','shops','industry','leisure'];
  const cells=s.nodes.map((n,i)=>({id:'c'+i,x:n.x,y:n.y,w:8,h:8,area:.13,people:3000+i*200,jobs:1500+i*100,shops:500,industry:50,leisure:200}));
  const forecast=D.evaluate(s,{cells,totals:Object.fromEntries(fields.map(k=>[k,cells.reduce((n,c)=>n+c[k],0)])),metadata:{effectiveConnections:true,demandZoneUnits:40}},{compact:true});
  const compact=require('../rail/forecast-catalog').transport(forecast),f={...forecast,flows:Array.from(forecast.flows)};delete f.preparedDefinitions;
  const inputPath=path.join(temp,'input.bin'),compactPath=path.join(temp,'compact.bin');fs.writeFileSync(inputPath,v8.serialize({s,f}));fs.writeFileSync(compactPath,v8.serialize({s,compact}));
  const results=[];let expected;
  for(let round=0;round<2;round++)for(const mode of round?[...modes].reverse():modes){
   const statePath=path.join(temp,`${round}-${mode}.bin`);
   const child=spawnSync(process.execPath,['--expose-gc',__filename,mode,mode==='javascript'?inputPath:compactPath,statePath,baselineRoot],{encoding:'utf8',timeout:180000});
   if(child.status)throw Error(child.stderr||child.stdout);
   const actual=v8.deserialize(fs.readFileSync(statePath));if(expected)assert.deepEqual(actual,expected,'complete world and runtime must match');else expected=actual;
   results.push({...JSON.parse(child.stdout),round});
  }
  const median=a=>{a.sort((a,b)=>a-b);const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
  const summary=modes.map(mode=>{const rows=results.filter(r=>r.mode===mode);return{mode,medianMs:median(rows.flatMap(r=>r.samplesMs)),medianCpuMs:median(rows.flatMap(r=>r.cpuMicros))/1000,
   retainedHeapMiB:median(rows.flatMap(r=>r.heapMiB)),eventLoopMaxMs:Math.max(...rows.flatMap(r=>r.eventLoopMaxMs)),peakRssMiB:Math.max(...rows.map(r=>r.peakRssMiB)),wasmMiB:rows[0].wasmMiB,requests:rows[0].requests,inputBytes:rows[0].inputBytes,outputBytes:rows[0].outputBytes,checksum:rows[0].checksum};});
  console.log(JSON.stringify({baselineCommit:BASELINE,scope:'Continuous operating core only: shared serialized world/forecast; 30 warmup + 5 x 30 game minutes; unchanged .1-minute quantum; current uses compact DTO; previous/JS receive equivalent full flows; excludes forecast, routing benchmarks, construction, DOM/map rendering and FPS',
   method:'Eight independent processes; both Rust versions load compact forecasts, JS uses full forecasts; reversed order in round 2; exact complete state comparison, no excluded fields; forced GC outside timed batches',lines:s.services.length,stations:s.nodes.length,summary,results},null,2));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
