/* News-only artifact selection, provenance and legacy game URL compatibility. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {DASHBOARD,stageDashboard,assemble}=require('./site_artifacts.cjs'),{select}=require('./select_publication.cjs');
const SHA=c=>c.repeat(40),context={repo:{owner:'xxbo',repo:'xxbo.github.io'}};
const run=(id,c,date,extra={})=>({id,head_sha:SHA(c),created_at:date,conclusion:'success',head_branch:'main',head_repository:{full_name:'xxbo/xxbo.github.io'},event:'push',...extra});
function api(runs,artifact={name:'dashboard-public',expired:false}){return {rest:{actions:{listWorkflowRuns:async args=>{assert.equal(args.workflow_id,'refresh-dashboard.yml');return{data:{workflow_runs:runs}};},listWorkflowRunArtifacts:async()=>({data:{artifacts:artifact?[artifact]:[]}})}}};}
(async()=>{
 await assert.rejects(select({github:api([]),context}),/No successful/);
 const valid=run(2,'b','2026-11-10'),older=run(1,'a','2026-11-09');
 const untrusted=run(9,'c','2026-11-11',{head_repository:{full_name:'someone/else'}});
 assert.deepEqual(await select({github:api([older,untrusted,valid]),context}),{dashboard_sha:SHA('b'),dashboard_run_id:'2'});
 await assert.rejects(select({github:api([valid],null),context}),/missing or expired/);
 await assert.rejects(select({github:api([valid],{name:'dashboard-public',expired:true}),context}),/missing or expired/);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'news-only-'));
 try{
  const source=path.join(temp,'source'),snapshot=path.join(temp,'snapshot'),target=path.join(temp,'site'),meta={kind:'dashboard',schemaVersion:2,source:SHA('b'),runId:'2'};
  for(const file of DASHBOARD){fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.writeFileSync(path.join(source,file),file);}
  stageDashboard(source,snapshot,meta);assemble(snapshot,target,{dashboard:{sha:SHA('b'),runId:'2'}});
  assert.equal(fs.readFileSync(path.join(target,'rail/index.html'),'utf8'),'rail/index.html');
  assert(!fs.existsSync(path.join(target,'rail/ui.js')));assert(!fs.existsSync(path.join(target,'rust')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(target,'deployment.json'))).game.repository,'xxbo/rail-city');
  assert.throws(()=>assemble(snapshot,target,{dashboard:{sha:SHA('b'),runId:'2'}}),/empty/);
  assert.throws(()=>assemble(snapshot,path.join(temp,'wrong'),{dashboard:{sha:SHA('c'),runId:'2'}}),/provenance/);
  fs.writeFileSync(path.join(snapshot,'component.json'),JSON.stringify({...meta,schemaVersion:1}));assert.throws(()=>assemble(snapshot,path.join(temp,'old'),{dashboard:{sha:SHA('b'),runId:'2'}}),/provenance/);
  fs.writeFileSync(path.join(snapshot,'component.json'),JSON.stringify(meta));fs.unlinkSync(path.join(snapshot,'rail/index.html'));fs.symlinkSync(path.join(source,'index.html'),path.join(snapshot,'rail/index.html'));
  assert.throws(()=>assemble(snapshot,path.join(temp,'unsafe'),{dashboard:{sha:SHA('b'),runId:'2'}}),/regular file/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 const bridge=fs.readFileSync('rail/index.html','utf8'),script=bridge.match(/<script>([\s\S]*?)<\/script>/)[1];
 for(const old of ['https://xxbo.github.io/rail/','https://xxbo.github.io/rail/index.html?map=gba#route']){
  const url=new URL(old);let next;vm.runInNewContext(script,{URL,location:{href:old,search:url.search,hash:url.hash,replace:v=>{next=new URL(v);}}});assert.equal(next.origin,url.origin);assert.equal(next.pathname,'/rail-city/');assert.equal(next.search,url.search);assert.equal(next.hash,url.hash);
 }
 const news=fs.readFileSync('.github/workflows/refresh-dashboard.yml','utf8'),publish=fs.readFileSync('.github/workflows/publish-site.yml','utf8');
 assert(!fs.existsSync('.github/workflows/rail-game.yml'));assert(!fs.existsSync('rust'));assert.deepEqual(fs.readdirSync('rail'),['index.html']);
 assert(!news.includes('rustup')&&!news.includes('run_rail_tests'));assert(!publish.includes('game_sha')&&!publish.includes('Update rail game'));assert(publish.includes("workflows: ['Refresh dashboard']"));
 console.log('News-only publication: trusted latest dashboard, required v2 provenance, missing/expired artifact rejection, no game dependency and same-origin query/hash redirect passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
