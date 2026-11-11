import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../../scripts/e2e-real.mjs', import.meta.url));

test('e2e:real accepts the documented --force-install option', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--force-install', '--help'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /--force-install\s+allow --installer/);
});
