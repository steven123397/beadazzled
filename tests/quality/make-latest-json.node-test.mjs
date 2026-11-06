import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { UPDATER_PLATFORM } from '../../scripts/lib/release-meta.mjs';
import { createTempRoots, signatureBlob, writeInstaller, writeRepo } from './release-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const makeScript = path.join(repoRoot, 'scripts/make-latest-json.mjs');
const verifyScript = path.join(repoRoot, 'scripts/verify-release.mjs');

const { makeRoot, cleanup } = createTempRoots('beadazzled-latest-');
afterEach(cleanup);

test('the generated manifest passes verify-release', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer, bytes } = writeInstaller(dir);

  const made = spawnSync(
    process.execPath,
    [makeScript, '--root', root, '--installer', installer, '--notes', 'First release'],
    { encoding: 'utf8' }
  );
  assert.equal(made.status, 0, made.stdout + made.stderr);

  const manifest = JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.notes, 'First release');
  assert.equal(manifest.platforms[UPDATER_PLATFORM].signature, signatureBlob(bytes));

  const verified = spawnSync(
    process.execPath,
    [verifyScript, '--root', root, '--installer', installer, '--json'],
    { encoding: 'utf8' }
  );
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.equal(JSON.parse(verified.stdout).passed, true);
});

test('a missing signature is reported instead of writing a manifest', () => {
  const root = makeRoot();
  writeRepo(root);
  const installer = path.join(root, 'beadazzled_0.1.0_x64-setup.exe');
  writeFileSync(installer, 'bytes');

  const made = spawnSync(process.execPath, [makeScript, '--root', root, '--installer', installer], {
    encoding: 'utf8',
  });

  assert.equal(made.status, 1);
  assert.match(made.stderr, /missing signature/);
});
