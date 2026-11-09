/* Two independently validated components must survive concurrent/reordered publications. */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {DASHBOARD, stageDashboard, assemble} = require('./site_artifacts.cjs');
const {BASELINE, select} = require('./select_publication.cjs');
const REPO = 'xxbo/xxbo.github.io', SHA = c => c.repeat(40);
const context = {repo: {owner: 'xxbo', repo: 'xxbo.github.io'}};
const run = (id, sha, extra = {}) => ({id, head_sha: sha, head_branch: 'main',
  head_repository: {full_name: REPO}, event: 'push', conclusion: 'success',
  created_at: new Date(id * 1000).toISOString(), ...extra});
function mock(game, news, artifacts = {}, old = true) {
  return {rest: {actions: {
    listWorkflowRuns: async ({workflow_id}) => ({data: {workflow_runs: workflow_id === 'rail-game.yml' ? game : news}}),
    listWorkflowRunArtifacts: async ({run_id}) => ({data: {artifacts: artifacts[run_id] || []}})
  }, repos: {getContent: async () => {if (old) throw Object.assign(Error('legacy'), {status: 404}); return {data: {}};}}}};
}
(async () => {
  const artifact = {name: 'dashboard-public', expired: false};
  let result = await select({context, github: mock([], [])});
  assert.equal(result.game_sha, BASELINE); assert.equal(result.dashboard_sha, BASELINE);
  // A newer failed, fork or non-main run never displaces an older trusted success.
  const game = [run(5, SHA('e'), {conclusion: 'failure'}), run(4, SHA('d'), {head_branch: 'dev'}),
    run(3, SHA('c'), {head_repository: {full_name: 'fork/repo'}}), run(1, SHA('a')), run(2, SHA('b'))];
  result = await select({context, github: mock(game, [run(7, SHA('c'))], {7: [artifact]})});
  assert.deepEqual(result, {game_sha: SHA('b'), game_run_id: '2', dashboard_sha: SHA('c'), dashboard_run_id: '7'});
  // Either trigger resolves BOTH latest successes, so coalesced/reordered events converge.
  for (const trigger of ['game', 'news']) {
    const selected = await select({context: {...context, trigger}, github: mock([run(9, SHA('d'))], [run(10, SHA('e'))], {10: [artifact]})});
    assert.equal(selected.game_sha, SHA('d')); assert.equal(selected.dashboard_sha, SHA('e'));
  }
  await assert.rejects(select({context, github: mock([], [run(7, SHA('c'))], {7: [{...artifact, expired: true}]})}), /expired/);
  await assert.rejects(select({context, github: mock([], [run(7, SHA('c'))], {}, false)}), /no public artifact/);
  result = await select({context, github: mock([], [run(7, SHA('c'))])});
  assert.equal(result.dashboard_sha, BASELINE);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-publication-'));
  try {
    const source = path.join(temp, 'source'), dashboard = path.join(temp, 'dashboard'), gameDir = path.join(temp, 'game');
    for (const file of DASHBOARD) {fs.mkdirSync(path.dirname(path.join(source, file)), {recursive: true}); fs.writeFileSync(path.join(source, file), 'news:' + file);}
    fs.mkdirSync(path.join(gameDir, 'rail/wasm'), {recursive: true});
    fs.writeFileSync(path.join(gameDir, 'rail/index.html'), 'validated-game');
    fs.writeFileSync(path.join(gameDir, 'rail/wasm/rail-core-v11.wasm'), Buffer.from([0, 97, 115, 109]));
    fs.writeFileSync(path.join(gameDir, 'rail/simulation-worker.js'), 'worker');
    fs.writeFileSync(path.join(source, 'private.txt'), 'exclude');
    stageDashboard(source, dashboard, {kind: 'dashboard', source: SHA('a'), runId: 1});
    const provenance = {dashboard: {sha: SHA('a'), runId: '1'}, game: {sha: SHA('b'), runId: '2'}};
    const target = path.join(temp, 'site'); assemble(dashboard, gameDir, target, provenance);
    for (const file of DASHBOARD) assert.equal(fs.readFileSync(path.join(target, file), 'utf8'), 'news:' + file);
    assert.equal(fs.readFileSync(path.join(target, 'rail/index.html'), 'utf8'), 'validated-game');
    assert(fs.existsSync(path.join(target, 'rail/simulation-worker.js')));
    assert(!fs.existsSync(path.join(target, 'private.txt')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'deployment.json'))), provenance);
    assert.throws(() => assemble(dashboard, gameDir, target, provenance), /empty/);
    assert.throws(() => assemble(dashboard, gameDir, path.join(temp, 'wrong'), {...provenance, dashboard: {sha: SHA('c'), runId: '1'}}), /provenance/);
    fs.symlinkSync(path.join(source, 'private.txt'), path.join(gameDir, 'rail/private.txt'));
    assert.throws(() => assemble(dashboard, gameDir, path.join(temp, 'symlink'), provenance), /symlink/);
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
  const news = fs.readFileSync('.github/workflows/refresh-dashboard.yml', 'utf8');
  const gameWorkflow = fs.readFileSync('.github/workflows/rail-game.yml', 'utf8');
  const publication = fs.readFileSync('.github/workflows/publish-site.yml', 'utf8');
  function filters(text) {
    const section=text.match(/    paths:\n((?:      - .+\n)+)/)[1];
    return section.trim().split('\n').map(s=>s.trim().slice(3,-1));
  }
  function matches(pattern,file) {
    const source=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'~DOUBLE~').replace(/\*/g,'[^/]*').replace(/~DOUBLE~/g,'.*');
    return new RegExp('^'+source+'$').test(file);
  }
  function triggered(text,file) {
    return filters(text).reduce((yes,p)=>matches(p.startsWith('!')?p.slice(1):p,file)?!p.startsWith('!'):yes,false);
  }
  for(const file of ['rail/ui.js','rail/wasm/rail-core-v11.wasm','rust/rail-routing/src/cycle.rs',
    'scripts/test_rail_map51.cjs','scripts/fixtures/rail-map50-passengers.cjs','scripts/run_rail_tests.cjs']) {
    assert(triggered(gameWorkflow,file),file);assert(!triggered(news,file),file);
  }
  for(const file of ['index.html','feed.js','style.css','scripts/update_data.py','scripts/test_feed.cjs','scripts/fixtures/news.json']) {
    assert(triggered(news,file),file);assert(!triggered(gameWorkflow,file),file);
  }
  for(const file of ['scripts/site_artifacts.cjs','scripts/select_publication.cjs','scripts/test_site_publication.cjs','.github/workflows/publish-site.yml']) {
    assert(triggered(news,file),file);assert(triggered(gameWorkflow,file),file);
  }
  assert(!news.includes('rustup') && !news.includes('run_rail_tests') && !news.includes('deploy-pages'));
  assert(!gameWorkflow.includes('update_data.py') && !gameWorkflow.includes('deploy-pages'));
  assert(news.indexOf('Stage validated dashboard') < news.indexOf('git pull --rebase'));
  assert(publication.includes('pages-production') && publication.includes('cancel-in-progress: false'));
  console.log('Publication passed: independent lanes, latest successful selection, legacy bootstrap, expired/missing artifact rejection, source provenance, complete-site composition and symlink rejection.');
})().catch(error => {console.error(error); process.exitCode = 1;});
