/* News publication uses only this repository's latest trusted successful dashboard artifact. */
function trusted(run,repository){return run.conclusion==='success'&&run.head_branch==='main'&&run.head_repository?.full_name===repository&&/^[a-f0-9]{40}$/.test(run.head_sha)&&['push','schedule','workflow_dispatch'].includes(run.event);}
async function select({github,context}){
 const repo=context.repo,repository=repo.owner+'/'+repo.repo;
 const {data}=await github.rest.actions.listWorkflowRuns({...repo,workflow_id:'refresh-dashboard.yml',branch:'main',status:'success',per_page:30});
 const news=data.workflow_runs.filter(r=>trusted(r,repository)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id)[0];
 if(!news)throw Error('No successful dashboard snapshot; run Refresh dashboard first');
 const result=await github.rest.actions.listWorkflowRunArtifacts({...repo,run_id:news.id,per_page:100});
 const artifact=result.data.artifacts.find(a=>a.name==='dashboard-public');
 if(!artifact||artifact.expired)throw Error('Latest dashboard artifact missing or expired; run Refresh dashboard first');
 return {dashboard_sha:news.head_sha,dashboard_run_id:String(news.id)};
}
module.exports={trusted,select};
