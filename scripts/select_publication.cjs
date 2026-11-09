/* Resolve both last-successful components after acquiring the common deployment lock. */
const BASELINE = 'b2b8fa682adc8da3d0dd958a343c08b31443a329';
function trusted(run, repository) {
  return run.conclusion === 'success' && run.head_branch === 'main' &&
    run.head_repository?.full_name === repository && /^[a-f0-9]{40}$/.test(run.head_sha) &&
    ['push', 'schedule', 'workflow_dispatch'].includes(run.event);
}
async function select({github, context}) {
  const repo = context.repo, repository = repo.owner + '/' + repo.repo;
  async function runs(workflow_id) {
    try {
      const result = await github.rest.actions.listWorkflowRuns({...repo, workflow_id,
        branch: 'main', status: 'success', per_page: 30});
      return result.data.workflow_runs.filter(run => trusted(run, repository)).sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    } catch (error) {
      if (error.status === 404 && workflow_id === 'rail-game.yml') return [];
      throw error;
    }
  }
  const [gameRuns, newsRuns] = await Promise.all([runs('rail-game.yml'), runs('refresh-dashboard.yml')]);
  const game = gameRuns[0];
  const news = newsRuns[0];
  let dashboardRunId = '', dashboardSha = BASELINE;
  if (news) {
    const result = await github.rest.actions.listWorkflowRunArtifacts({...repo, run_id: news.id, per_page: 100});
    const artifact = result.data.artifacts.find(a => a.name === 'dashboard-public');
    if (artifact) {
      if (artifact.expired) throw Error('Latest dashboard artifact expired; refresh dashboard before publishing');
      dashboardRunId = String(news.id); dashboardSha = news.head_sha;
    } else {
      // Only pre-split runs may bootstrap from the already deployed MAP51 snapshot.
      let oldFormat = false;
      try { await github.rest.repos.getContent({...repo, path: '.github/workflows/rail-game.yml', ref: news.head_sha}); }
      catch (error) { if (error.status === 404) oldFormat = true; else throw error; }
      if (!oldFormat) throw Error('Successful dashboard run has no public artifact');
    }
  }
  return {game_sha: game?.head_sha || BASELINE, game_run_id: game ? String(game.id) : '',
    dashboard_sha: dashboardSha, dashboard_run_id: dashboardRunId};
}
module.exports = {BASELINE, trusted, select};
