/* Async presentation debt survives worker roundtrips; pause/reset never revives old debt. */
const assert=require('node:assert/strict');
const Perf=require('../rail/performance');
const Core=require('../rail/routing-wasm');
const Client=require('../rail/simulation-client');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const clock=Perf.createClock();let finish,calls=0;
  const advance=(minutes)=>{calls++;return new Promise(resolve=>{finish=()=>resolve({remaining:minutes-.2,steps:2,running:true});});};
  clock.runAsync(.1,6,6,advance,()=>0);await turn();
  for(let i=0;i<5;i++)clock.runAsync(.02,6,6,advance,()=>0);
  assert.equal(calls,1);const debt=clock.pending;
  finish();await turn();assert.equal(clock.pending,debt-.2);
  clock.runAsync(0,6,6,advance,()=>0);await turn();
  clock.reset();finish();await turn();assert.equal(clock.pending,0);
  const blocked=Perf.createClock();
  blocked.runAsync(.1,6,6,async()=>({remaining:.5,steps:0,running:false}),()=>0);
  await turn();assert.equal(blocked.runAsync(0,6,6,advance,()=>0).ok,false);assert.equal(blocked.pending,0);
  const invalid=Perf.createClock();
  invalid.runAsync(.1,6,6,async()=>({remaining:100,steps:1,running:true}),()=>0);
  await turn();assert.throws(()=>invalid.runAsync(0,6,6,advance,()=>0));
  // Same Rust kernel in environments without Worker. No alternative simulation algorithm.
  const P=require('../rail/passengers'),M=require('../rail/management'),{create}=require('./fixtures/rail-memory-grid.cjs');
  const state=create(2),rt=P.create(state,{preparedDefinitions:[]},480,false);
  let captured;const kernel=Core.kernel;
  Core.kernel=(name,input,...args)=>{
    if(name==='engine_cycle')captured={name,input:input.slice(),bytes:args[2]?.slice()};
    return kernel(name,input,...args);
  };
  try{M.advance(state,rt,.1);}finally{Core.kernel=kernel;}
  Core.recycleSimulation();
  const local=Client.create({forceLocal:true});
  assert.equal(await local.run(function*(){return Core.cycleToken();}),0);
  await local.run(function*(){const result=yield captured;assert.equal(result[0],1);assert.equal(result[1],0);});
  local.close();
  const worker=Client.create();
  try {
    await assert.rejects(worker.run(function*(){yield {name:'forbidden',input:new Float64Array()};}),/Unknown simulation worker operation/);
    await assert.rejects(worker.run(function*(){yield {name:'forbidden',input:new Float64Array()};}),/Unknown simulation worker operation/);
  }finally{worker.close();}
  console.log('MAP51 async clock: serialized in-flight batches, retained debt, pause/reset, blocked/fault validation, same-kernel local mode and worker rejection cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
