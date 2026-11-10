/* Check the published project root, relative workers/assets, immutability and unsafe inputs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {stage}=require('./publish_rail.cjs');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rail-publication-'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
try{
 const out=path.join(tmp,'site'),root=path.resolve(__dirname,'..'),provenance={repository:'xxbo/rail-city',source:'a'.repeat(40),runId:'1'};
 stage(root,out,provenance);
 assert.equal(hash(path.join(out,'index.html')),hash(path.join(root,'rail/index.html')));
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out,'deployment.json'))),{kind:'rail-city',...provenance});
 for(const name of ['simulation-worker.js','demand-worker.js','operations-worker.js','wasm/rail-core-v23.wasm'])assert.equal(hash(path.join(out,name)),hash(path.join(root,'rail',name)));
 const html=fs.readFileSync(path.join(out,'index.html'),'utf8');
 for(const [,src]of html.matchAll(/(?:src|href)="([^"#]+)"/g))if(!/^(https?:|data:|#)/.test(src)){
  const url=new URL(src,'https://xxbo.github.io/rail-city/');assert(url.pathname.startsWith('/rail-city/'));assert(fs.existsSync(path.join(out,url.pathname.slice('/rail-city/'.length))),src);
 }
 assert(!fs.existsSync(path.join(out,'rail')));assert(!fs.existsSync(path.join(out,'data/dashboard.json')));assert(!fs.existsSync(path.join(out,'rust')));
 assert.throws(()=>stage(root,out),/empty/);
 const unsafe=path.join(tmp,'unsafe');fs.mkdirSync(path.join(unsafe,'rail'),{recursive:true});fs.writeFileSync(path.join(unsafe,'rail/index.html'),'game');fs.symlinkSync(path.join(out,'index.html'),path.join(unsafe,'rail/link'));
 assert.throws(()=>stage(unsafe,path.join(tmp,'bad')),/symlink/);
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/game.yml'),'utf8');assert(workflow.includes('needs: verify'));assert(workflow.includes("github.event_name != 'pull_request'"));assert(!workflow.includes('Refresh dashboard'));assert(!workflow.includes('select_publication'));
 const old=new URL('https://xxbo.github.io/rail/'),next=new URL('https://xxbo.github.io/rail-city/');assert.equal(old.origin,next.origin);
 assert(fs.readFileSync(path.join(root,'rail/save-store.js'),'utf8').includes("idb.open('guanchao-rail-checkpoints', 1)"));
 console.log('Standalone game publication: exact game bytes, project-root assets/workers, same-origin saves, isolated artifact, PR deploy guard and symlink rejection passed.');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
