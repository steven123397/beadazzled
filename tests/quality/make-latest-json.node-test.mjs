import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { UPDATER_PLATFORM } from '../../scripts/lib/release-meta.mjs';
import { scriptFor, spawnCheck, withTempRoots } from './helpers.mjs';
import { signatureBlob, writeInstaller, writeRepo } from './release-fixtures.mjs';

const makeScript = scriptFor('make-latest-json');
const verifyScript = scriptFor('verify-release');

const { makeRoot } = withTempRoots({ prefix: 'beadazzled-latest-' });

test('the generated manifest passes verify-release', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer, bytes } = writeInstaller(dir);

  const made = spawnCheck(makeScript, [
    '--root',
    root,
    '--installer',
    installer,
    '--notes',
    'First release',
  ]);
  assert.equal(made.status, 0, made.stdout + made.stderr);

  const manifest = JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.notes, 'First release');
  assert.equal(manifest.platforms[UPDATER_PLATFORM].signature, signatureBlob(bytes));

  const verified = spawnCheck(verifyScript, ['--root', root, '--installer', installer, '--json']);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.equal(JSON.parse(verified.stdout).passed, true);
});

test('a missing signature is reported instead of writing a manifest', () => {
  const root = makeRoot();
  writeRepo(root);
  const installer = path.join(root, 'beadazzled_0.1.0_x64-setup.exe');
  writeFileSync(installer, 'bytes');

  const made = spawnCheck(makeScript, ['--root', root, '--installer', installer]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /missing signature/);
});
