import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_FILES, resolvePublicRoute } from './server-routes.ts';

test('resolves root and rail entry paths cleanly', () => {
  assert.deepEqual(resolvePublicRoute('/'), {
    kind: 'file',
    target: 'index.html',
    cacheControl: 'no-cache',
  });
  assert.deepEqual(resolvePublicRoute('/rail'), {
    kind: 'redirect',
    target: '/rail/',
    cacheControl: 'no-cache',
  });
  assert.deepEqual(resolvePublicRoute('/rail/'), {
    kind: 'file',
    target: 'rail/index.html',
    cacheControl: 'no-cache',
  });
  assert.equal(resolvePublicRoute('/rail-city/')?.kind, 'rail-city-bridge');
});

test('allows all validated dashboard public assets and fresh snapshot JSON', () => {
  for (const file of PUBLIC_FILES) {
    const resolved = resolvePublicRoute('/' + file);
    assert.ok(resolved, `expected /${file} to resolve`);
    assert.equal(resolved.kind, 'file');
    assert.equal(resolved.target, file);
  }
  assert.equal(
    resolvePublicRoute('/data/dashboard.json')?.cacheControl,
    'no-cache, no-store, must-revalidate',
  );
});

test('blocks internal source files, scripts, dotfiles, and path traversal', () => {
  const blocked = [
    '/server.ts',
    '/package.json',
    '/tsconfig.json',
    '/.env',
    '/.git/config',
    '/scripts/update_data.py',
    '/scripts/site_artifacts.cjs',
    '/../package.json',
    '/%2e%2e/package.json',
    '/%E0%A4%A',
  ];
  for (const candidate of blocked) {
    assert.equal(resolvePublicRoute(candidate), null, `expected ${candidate} to be blocked`);
  }
});
