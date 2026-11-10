/* Stage and publish the validated news snapshot; the game deploys from its own repository. */
const fs = require('node:fs');
const path = require('node:path');
const DASHBOARD = Object.freeze([
  'intraday.js', 'news-media.js', 'split-reader.js', 'feed.js', 'home-feed.js', 'feed.css',
  'live-quotes.js', 'global.js', 'global-pages.js', 'desk.js', 'desk-pages.js', 'ui.js',
  'reading.js', 'reading-pages.js', 'market-context.js', 'context-pages.js', 'events.js',
  'event-pages.js', 'index.html', 'style.css', 'brief.js', 'topics.js', 'topic-pages.js',
  'calendar.js', 'calendar-pages.js', 'health-pages.js', 'home.js', 'app.js', 'pages.js',
  'reader.js', 'technical.js', 'analysis-pages.js', 'data/dashboard.json', 'rail/index.html'
]);
function copyFile(source, target, file) {
  const input = path.join(source, file), output = path.join(target, file);
  if (!fs.lstatSync(input).isFile() || fs.lstatSync(input).isSymbolicLink())
    throw Error('Public file must be a regular file: ' + file);
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.copyFileSync(input, output);
}
function stageDashboard(source, target, provenance) {
  fs.mkdirSync(target, {recursive: true});
  for (const file of DASHBOARD) copyFile(source, target, file);
  if (provenance) fs.writeFileSync(path.join(target, 'component.json'), JSON.stringify(provenance));
}
function assemble(dashboard,target,provenance) {
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw Error('Release target must be empty');
  const metadata=JSON.parse(fs.readFileSync(path.join(dashboard,'component.json')));
  if(metadata.kind!=='dashboard'||metadata.schemaVersion!==2||metadata.source!==provenance.dashboard.sha||String(metadata.runId)!==String(provenance.dashboard.runId))throw Error('Dashboard provenance mismatch');
  for(const file of DASHBOARD)copyFile(dashboard,target,file);
  fs.writeFileSync(path.join(target,'deployment.json'),JSON.stringify({...provenance,game:{repository:'xxbo/rail-city',url:'/rail-city/'}},null,2)+'\n');
  fs.writeFileSync(path.join(target,'.nojekyll'),'');
}
if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'dashboard') stageDashboard(args[0], args[1], {
    kind: 'dashboard', schemaVersion: 2, source: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID
  });
  else if (command === 'assemble') assemble(args[0], args[1], {
    dashboard: {sha: process.env.DASHBOARD_SHA, runId: process.env.DASHBOARD_RUN_ID || null}
  });
  else throw Error('Unknown publication command');
}
module.exports = {DASHBOARD, stageDashboard, assemble};
