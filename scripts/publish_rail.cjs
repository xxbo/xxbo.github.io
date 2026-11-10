/* Stage only this repository's game, preserving project-Pages relative asset paths. */
const fs=require('node:fs'),path=require('node:path');
function stage(source,target,provenance={}){
 const game=path.join(source,'rail');
 if(fs.existsSync(target)&&fs.readdirSync(target).length)throw Error('Publication target must be empty');
 if(!fs.lstatSync(path.join(game,'index.html')).isFile())throw Error('Game entry missing');
 for(const entry of fs.readdirSync(game,{recursive:true}))if(fs.lstatSync(path.join(game,entry)).isSymbolicLink())throw Error('Game contains a symlink');
 fs.mkdirSync(target,{recursive:true});fs.cpSync(game,target,{recursive:true});
 fs.writeFileSync(path.join(target,'.nojekyll'),'');
 fs.writeFileSync(path.join(target,'deployment.json'),JSON.stringify({kind:'rail-city',...provenance},null,2)+'\n');
}
if(require.main===module)stage(process.argv[2]||'.',process.argv[3]||'_site',{repository:process.env.GITHUB_REPOSITORY,source:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID});
module.exports={stage};
