import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

test('an invalid signature is rejected instead of writing a manifest', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer } = writeInstaller(dir, {
    signature: signatureBlob(Buffer.from('different installer bytes')),
  });

  const made = spawnCheck(makeScript, ['--root', root, '--installer', installer]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /signature does not match the artifact/);
  assert.equal(existsSync(path.join(dir, 'latest.json')), false);
});

test('a download URL outside the pinned GitHub release prefix is rejected', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer } = writeInstaller(dir);

  const made = spawnCheck(makeScript, [
    '--root',
    root,
    '--installer',
    installer,
    '--url',
    'https://example.com/beadazzled_0.1.0_x64-setup.exe',
  ]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /release URL must use https and match/);
  assert.equal(existsSync(path.join(dir, 'latest.json')), false);
});

test('a canonicalized URL cannot escape the pinned repository', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer, installerName } = writeInstaller(dir);

  const made = spawnCheck(makeScript, [
    '--root',
    root,
    '--installer',
    installer,
    '--url',
    `https://github.com/steven123397/beadazzled/releases/%2e%2e/%2e%2e/%2e%2e/attacker/repo/releases/download/v0.1.0/${installerName}`,
  ]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /release URL must use https and match/);
  assert.equal(existsSync(path.join(dir, 'latest.json')), false);
});

test('a custom URL must match the version directory and installer name', () => {
  for (const url of [
    'https://github.com/steven123397/beadazzled/releases/download/v0.1.0/other.exe',
    'https://github.com/steven123397/beadazzled/releases/download/v0.1.1/beadazzled_0.1.0_x64-setup.exe',
  ]) {
    const root = makeRoot();
    writeRepo(root);
    const dir = path.join(root, 'release');
    const { installer } = writeInstaller(dir);

    const made = spawnCheck(makeScript, ['--root', root, '--installer', installer, '--url', url]);

    assert.equal(made.status, 1, url);
    assert.match(made.stderr, /release URL must use https and match/);
    assert.equal(existsSync(path.join(dir, 'latest.json')), false);
  }
});

test('a path-like version cannot redirect the expected release URL', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer, installerName } = writeInstaller(dir);

  const made = spawnCheck(makeScript, [
    '--root',
    root,
    '--installer',
    installer,
    '--version',
    '/../../../../../attacker/repo/releases/download/v0.1.0',
    '--url',
    `https://github.com/attacker/repo/releases/download/v0.1.0/${installerName}`,
  ]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /release version must be semantic/);
  assert.equal(existsSync(path.join(dir, 'latest.json')), false);
});

test('a signed version mismatch is rejected instead of writing a manifest', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer } = writeInstaller(dir, { signedVersion: '9.9.9' });

  const made = spawnCheck(makeScript, ['--root', root, '--installer', installer]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /signed version 9\.9\.9 does not match manifest version 0\.1\.0/);
  assert.equal(existsSync(path.join(dir, 'latest.json')), false);
});

test('a direct armored signature is rejected instead of writing an updater-invalid manifest', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer } = writeInstaller(dir);
  const signaturePath = `${installer}.sig`;
  const armored = Buffer.from(readFileSync(signaturePath, 'utf8').trim(), 'base64').toString(
    'utf8'
  );
  writeFileSync(signaturePath, armored);

  const made = spawnCheck(makeScript, ['--root', root, '--installer', installer]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /base64-wrapped|four-line/);
  assert.equal(existsSync(path.join(dir, 'latest.json')), false);
});

test('a signature box without the untrusted comment line is rejected', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  const { installer } = writeInstaller(dir);
  const signaturePath = `${installer}.sig`;
  const armored = Buffer.from(readFileSync(signaturePath, 'utf8').trim(), 'base64')
    .toString('utf8')
    .split('\n')
    .filter((line) => !line.startsWith('untrusted comment:'))
    .join('\n');
  writeFileSync(signaturePath, Buffer.from(armored, 'utf8').toString('base64'));

  const made = spawnCheck(makeScript, ['--root', root, '--installer', installer]);

  assert.equal(made.status, 1);
  assert.match(made.stderr, /four-line/);
  assert.equal(existsSync(path.join(dir, 'latest.json')), false);
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
