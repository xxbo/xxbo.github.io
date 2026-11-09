const assert=require('node:assert/strict'),SIM=require('../rail/simulation-wasm'),Core=require('../rail/routing-wasm');
const s={ridership:null},catalog=Array.from({length:60000},(_,id)=>({daily:20+id%3,lineIds:['s1'],purpose:'work',back:false}));
SIM.trackCatalog(catalog);
let f=SIM.timedFrame(catalog,s,480,1,0,2463534242);Core.kernel('simulation_run',f.input);
const loaded=SIM.demandStatus(catalog);assert.equal(loaded.reads,60000);assert.equal(loaded.untracked,0);
for(let n=0;n<60;n++){f=SIM.timedFrame(catalog,s,481+n,1,0,2463534242);Core.kernel('simulation_run',f.input);}
assert.equal(SIM.demandStatus(catalog).reads,60000,'unchanged minute does not scan directory');
SIM.setDaily(catalog,3,catalog[3].daily+10);SIM.setDaily(catalog,888,0);SIM.setDaily(catalog,3,catalog[3].daily);
f=SIM.timedFrame(catalog,s,550,1,0,2463534242);assert.deepEqual(Array.from(f.input.slice(17)),[2,3,30,888,0]);Core.kernel('simulation_run',f.input);
assert.equal(SIM.demandStatus(catalog).reads,60002);assert.equal(SIM.demandStatus(catalog).revision,2);
Core.recycleSimulation();f=SIM.timedFrame(catalog,s,551,1,0,2463534242);assert.equal(f.input[2],1);Core.kernel('simulation_run',f.input);assert.equal(SIM.demandStatus(catalog).reads,120002);
let reads=0;const custom=[{get daily(){reads++;return reads;},lineIds:[],purpose:'leisure'}];
SIM.timedFrame(custom,s,480,1,0,1);SIM.timedFrame(custom,s,481,1,0,1);assert.equal(SIM.demandStatus(custom).untracked,1);assert.equal(reads,2);
console.log('MAP53 demand: 60000 tracked profiles, 60 unchanged minutes with zero directory reads, exact two-item delta, native recycle reload and getter compatibility.');
