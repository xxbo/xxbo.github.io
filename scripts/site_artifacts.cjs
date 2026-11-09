/* Build two public components; assemble only validated versions into one Pages release. */
const fs = require('node:fs');
const path = require('node:path');
const DASHBOARD = Object.freeze([
  'intraday.js', 'news-media.js', 'split-reader.js', 'feed.js', 'home-feed.js', 'feed.css',
  'live-quotes.js', 'global.js', 'global-pages.js', 'desk.js', 'desk-pages.js', 'ui.js',
  'reading.js', 'reading-pages.js', 'market-context.js', 'context-pages.js', 'events.js',
  'event-pages.js', 'index.html', 'style.css', 'brief.js', 'topics.js', 'topic-pages.js',
  'calendar.js', 'calendar-pages.js', 'health-pages.js', 'home.js', 'app.js', 'pages.js',
  'reader.js', 'technical.js', 'analysis-pages.js', 'data/dashboard.json'
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
function assemble(dashboard, game, target, provenance) {
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw Error('Release target must be empty');
  if (provenance.dashboard.runId) {
    const metadata = JSON.parse(fs.readFileSync(path.join(dashboard, 'component.json')));
    if (metadata.kind !== 'dashboard' || metadata.source !== provenance.dashboard.sha ||
        String(metadata.runId) !== String(provenance.dashboard.runId)) throw Error('Dashboard provenance mismatch');
  }
  for (const file of DASHBOARD) copyFile(dashboard, target, file);
  const rail = path.join(game, 'rail');
  if (!fs.statSync(path.join(rail, 'index.html')).isFile()) throw Error('Game entry missing');
  for (const entry of fs.readdirSync(rail, {recursive: true})) {
    const file = path.join(rail, entry);
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('Unexpected symlink in game');
  }
  fs.cpSync(rail, path.join(target, 'rail'), {recursive: true});
  fs.writeFileSync(path.join(target, 'deployment.json'), JSON.stringify(provenance, null, 2) + '\n');
  fs.writeFileSync(path.join(target, '.nojekyll'), '');
}
if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'dashboard') stageDashboard(args[0], args[1], {
    kind: 'dashboard', source: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID
  });
  else if (command === 'assemble') assemble(args[0], args[1], args[2], {
    dashboard: {sha: process.env.DASHBOARD_SHA, runId: process.env.DASHBOARD_RUN_ID || null},
    game: {sha: process.env.GAME_SHA, runId: process.env.GAME_RUN_ID || null}
  });
  else throw Error('Unknown publication command');
}
module.exports = {DASHBOARD, stageDashboard, assemble};
