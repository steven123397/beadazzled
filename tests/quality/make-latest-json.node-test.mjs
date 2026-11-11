import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { scriptFor, spawnCheck, withTempRoots } from './helpers.mjs';
import { signatureBlob, writeInstaller, writeRepo } from './release-fixtures.mjs';

const makeScript = scriptFor('make-latest-json');
const verifyScript = scriptFor('verify-release');

const { makeRoot } = withTempRoots({ prefix: 'beadazzled-latest-' });

test('the generated manifest passes verify-release and targets windows-x86_64', () => {
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
  assert.ok(manifest.platforms['windows-x86_64'], 'manifest must contain windows-x86_64 entry');
  assert.equal(manifest.platforms['windows-x86_64'].signature, signatureBlob(bytes));

  const verified = spawnCheck(verifyScript, ['--root', root, '--installer', installer, '--json']);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.equal(JSON.parse(verified.stdout).passed, true);
});

test('manifest generation accepts an empty release note', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer } = writeInstaller(dir);

  const madeInline = spawnCheck(makeScript, ['--root', root, '--installer', installer, '--notes=']);
  assert.equal(madeInline.status, 0, madeInline.stdout + madeInline.stderr);
  let manifest = JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  assert.equal(manifest.notes, '');

  const madeSeparate = spawnCheck(makeScript, [
    '--root',
    root,
    '--installer',
    installer,
    '--notes',
    '',
  ]);
  assert.equal(madeSeparate.status, 0, madeSeparate.stdout + madeSeparate.stderr);
  manifest = JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  assert.equal(manifest.notes, '');
});

test('required options reject empty values', () => {
  const root = makeRoot();
  const made = spawnCheck(makeScript, ['--root', root, '--installer=']);
  assert.equal(made.status, 1);
  assert.match(made.stderr, /--installer needs a value/);
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

test('the signature is checked before the installer is hashed', () => {
  const root = makeRoot();
  writeRepo(root);
  // Neither the installer nor its .sig exists: the signature error wins.
  const installer = path.join(root, 'beadazzled_0.1.0_x64-setup.exe');

  const made = spawnCheck(makeScript, ['--root', root, '--installer', installer]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /missing signature/);
});

test('a missing installer with a present signature is still reported', () => {
  const root = makeRoot();
  writeRepo(root);
  const installer = path.join(root, 'beadazzled_0.1.0_x64-setup.exe');
  writeFileSync(`${installer}.sig`, 'signature bytes');

  const made = spawnCheck(makeScript, ['--root', root, '--installer', installer]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /missing installer/);
});
