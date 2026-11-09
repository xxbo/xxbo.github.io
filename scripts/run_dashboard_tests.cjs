/* News/dashboard checks deliberately exclude game and shared publication checks. */
const fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const file of fs.readdirSync(__dirname).filter(f => /^test_.*\.cjs$/.test(f) &&
  !/^test_rail/.test(f) && f !== 'test_site_publication.cjs').sort()) {
  const result = spawnSync(process.execPath, [path.join('scripts', file)], {cwd: root, stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
