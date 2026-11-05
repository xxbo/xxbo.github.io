/* One discoverable entry point; new test_rail*.cjs files join CI automatically. */
const {
  readdirSync
} = require('node:fs');
const {
  join,
  resolve
} = require('node:path');
const {
  spawnSync
} = require('node:child_process');
const root = resolve(__dirname, '..');

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const file of readdirSync(join(root, 'rail')).filter(file => file.endsWith('.js')).sort()) {
  run(['--check', join('rail', file)]);
}
const suites = readdirSync(__dirname).filter(file => /^test_rail.*\.cjs$/.test(file)).sort();
for (const file of suites) run([join('scripts', file)]);
console.log(`Rail checks passed: syntax + ${suites.length} regression suites.`);
