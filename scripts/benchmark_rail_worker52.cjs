/* Real Worker roundtrips, both versions; count transferred numeric payloads outside kernels. */
const {spawnSync}=require('node:child_process');
if(!['map51','map52'].includes(process.argv[2])) {
  const results=[];
  for(let round=0;round<2;round++)for(const version of round?['map52','map51']:['map51','map52']) {
    const run=spawnSync(process.execPath,['--expose-gc',__filename,version,process.argv[2]||'5'],{encoding:'utf8',timeout:180000});
    if(run.status)throw Error(run.stderr);results.push({...JSON.parse(run.stdout),round});
  }
  if(results.some(r=>r.checksum!==results[0].checksum))throw Error('Worker state mismatch');
  const median=a=>{a.sort((x,y)=>x-y);return(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
  console.log(JSON.stringify({workload:'Independent processes, alternating order; real worker; 30 warmup + 5 x 30 game minutes, same .1-minute steps',
    summary:['map51','map52'].map(version=>{const rows=results.filter(r=>r.version===version);return {version,medianMs:median(rows.flatMap(r=>r.samplesMs)),inputBytes:rows[0].inputBytes,
      outputBytes:rows[0].outputBytes,requests:rows[0].requests,checksum:rows[0].checksum};}),results},null,2));
}else{
  const threads=require('node:worker_threads'),Base=threads.Worker,workers=[];
  threads.Worker=class extends Base {
    constructor(...args){super(...args);this.stats={inputBytes:0,outputBytes:0,requests:0};workers.push(this);
      this.on('message',data=>{this.stats.outputBytes+=data.result?.byteLength||0;});}
    postMessage(data,...args){this.stats.inputBytes+=(data.input?.byteLength||0)+(data.bytes?.byteLength||0);this.stats.requests++;return super.postMessage(data,...args);}
  };
  const old=process.argv[2]==='map51',P=old?require('./fixtures/rail-map51-passengers.cjs'):require('../rail/passengers'),
    M=old?require('./fixtures/rail-map51-management.cjs'):require('../rail/management'),D=require('../rail/demand-model'),
    {create}=require('./fixtures/rail-memory-grid.cjs'),crypto=require('node:crypto');
  (async()=>{
    const s=create(Number(process.argv[3])),fields=['people','jobs','shops','industry','leisure'];
    const cells=s.nodes.map((n,i)=>({id:'c'+i,x:n.x,y:n.y,w:8,h:8,area:.13,people:3000+i*200,jobs:1500+i*100,shops:500,industry:50,leisure:200}));
    const f=D.evaluate(s,{cells,totals:Object.fromEntries(fields.map(k=>[k,cells.reduce((n,c)=>n+c[k],0)])),metadata:{effectiveConnections:true,demandZoneUnits:40}});
    require('../rail/routing-wasm').recycleSimulation();
    const rt=P.create(s,f,480,false);s.economy.minute=480;
    try{
      const advance=minutes=>M.advanceBudgetAsync(s,rt,minutes,{budget:1e6,maxSteps:10000,now:()=>0});
      await advance(30);for(const w of workers)w.stats={inputBytes:0,outputBytes:0,requests:0};
      const samplesMs=[];
      for(let i=0;i<5;i++){const start=performance.now();await advance(30);samplesMs.push(performance.now()-start);}
      console.log(JSON.stringify({version:process.argv[2],samplesMs,lines:s.services.length,stations:s.nodes.length,...workers[0].stats,
        checksum:crypto.createHash('sha256').update(JSON.stringify({state:s,snapshot:P.snapshot(rt),defs:rt.defs})).digest('hex')}));
    }finally{P.dispose(rt);threads.Worker=Base;}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
