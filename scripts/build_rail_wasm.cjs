/* Reproducible, dependency-free Rust build. --check compares bytes without changing the asset. */
const {
  spawnSync
} = require('node:child_process');
const {
  readFileSync,
  writeFileSync,
  mkdirSync
} = require('node:fs');
const {
  join,
  resolve
} = require('node:path');
const crypto = require('node:crypto');
const root = resolve(__dirname, '..'),
  crate = join(root, 'rust/rail-routing');
const cargo = process.env.RAIL_CARGO || 'cargo';
for (const args of [
    ['test', '--locked', '--manifest-path', join(crate, 'Cargo.toml')],
    ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', join(crate, 'Cargo.toml')]
  ]) {
  const run = spawnSync(cargo, args, {
    stdio: 'inherit',
    cwd: crate,
    env: {
      ...process.env,
      CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: '-C link-arg=--max-memory=268435456'
    }
  });
  if (run.status !== 0) process.exit(run.status || 1);
}
const bytes = readFileSync(join(crate, 'target/wasm32-unknown-unknown/release/rail_routing.wasm'));
const target = join(root, 'rail/wasm/rail-core-v11.wasm');
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
if (process.argv.includes('--check')) {
  if (!readFileSync(target).equals(bytes)) throw Error('Committed WASM differs from pinned Rust source build');
} else {
  mkdirSync(join(root, 'rail/wasm'), {
    recursive: true
  });
  writeFileSync(target, bytes);
}
console.log(JSON.stringify({
  backend: 'Rust/WASM',
  bytes: bytes.length,
  sha256: hash
}));