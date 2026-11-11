import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { scriptFor, spawnCheck, withTempRoots } from './helpers.mjs';
import { publicKeyBlob, writeFixture } from './release-fixtures.mjs';

const scriptPath = scriptFor('verify-release');
const { makeRoot } = withTempRoots({ prefix: 'beadazzled-release-' });

function run(root, installer, extra = []) {
  return spawnCheck(scriptPath, ['--root', root, '--installer', installer, '--json', ...extra]);
}

test('a matching artifact, manifest and signature pass', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root);

  const result = run(root, installer);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.passed, true);
  assert.equal(summary.version, '0.1.0');
  assert.equal(summary.signature.verified, true);
  assert.equal(summary.sha256.length, 64);
});

test('the platform sha256 in latest.json is checked against the installer', () => {
  const good = createHash('sha256').update(Buffer.from('installer bytes')).digest('hex');
  const root = makeRoot();
  const { installer } = writeFixture(root, { entrySha256: good });

  const ok = run(root, installer);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);

  const badRoot = makeRoot();
  const bad = writeFixture(badRoot, { entrySha256: 'f'.repeat(64) });
  const result = run(badRoot, bad.installer);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /platforms\.windows-x86_64 sha256 does not match the installer/);
});

test('tampered installer bytes fail the signature check', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root);
  writeFileSync(installer, Buffer.from('tampered installer bytes'));

  const result = run(root, installer);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /signature does not match/);
});

test('a manifest version that differs from the sources fails', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root, {
    manifestVersion: '0.1.1',
    installerName: 'beadazzled_0.1.0_x64-setup.exe',
  });

  const result = run(root, installer);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /latest\.json is 0\.1\.1/);
});

test('an installer version must match between separators', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root, {
    version: '0.1.1',
    installerName: 'beadazzled_0.1.10_x64-setup.exe',
  });

  const result = run(root, installer);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not name version 0\.1\.1/);
});

test('a manifest URL that names another file fails', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root);
  const manifestPath = path.join(path.dirname(installer), 'latest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.platforms['windows-x86_64'].url =
    'https://github.com/steven123397/beadazzled/releases/download/v0.1.0/other.exe';
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const result = run(root, installer);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /release URL must use https and match/);
});

test('a manifest URL outside the pinned GitHub release prefix fails', () => {
  for (const url of [
    'http://github.com/steven123397/beadazzled/releases/download/v0.1.0/beadazzled_0.1.0_x64-setup.exe',
    'https://example.com/steven123397/beadazzled/releases/download/v0.1.0/beadazzled_0.1.0_x64-setup.exe',
    'https://github.com/steven123397/beadazzled/releases/../../../attacker/repo/releases/download/v0.1.0/beadazzled_0.1.0_x64-setup.exe',
    'https://github.com/steven123397/beadazzled/releases/%2e%2e/%2e%2e/%2e%2e/attacker/repo/releases/download/v0.1.0/beadazzled_0.1.0_x64-setup.exe',
  ]) {
    const root = makeRoot();
    const { installer } = writeFixture(root);
    const manifestPath = path.join(path.dirname(installer), 'latest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.platforms['windows-x86_64'].url = url;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = run(root, installer);

    assert.equal(result.status, 1, url);
    assert.match(result.stderr, /release URL must use https and match/);
  }
});

test('a manifest missing the windows-x86_64 platform entry fails', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root);
  const manifestPath = path.join(path.dirname(installer), 'latest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  delete manifest.platforms['windows-x86_64'];
  manifest.platforms['darwin-x86_64'] = {
    signature: 'AAAA',
    url: 'https://example.com/other.dmg',
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const result = run(root, installer);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /latest\.json has no platforms\.windows-x86_64 entry/);
});

test('a signature that differs from the .sig file fails', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root);
  const manifestPath = path.join(path.dirname(installer), 'latest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.platforms['windows-x86_64'].signature = 'AAAA';
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const result = run(root, installer);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the \.sig/);
});

test('an expected SHA-256 that does not match fails', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root);

  const result = run(root, installer, ['--sha256', '0'.repeat(64)]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA-256 is/);
});

test('a literal --public-key is accepted as key material', () => {
  const root = makeRoot();
  const { installer } = writeFixture(root);

  const result = run(root, installer, ['--public-key', publicKeyBlob]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).signature.verified, true);
});

test('--public-key-file reads key material from the named file', () => {
  const root = makeRoot();
  const { installer, dir } = writeFixture(root);
  const keyFile = path.join(dir, 'updater.pub');
  writeFileSync(keyFile, publicKeyBlob);

  const result = run(root, installer, ['--public-key-file', keyFile]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).signature.verified, true);
});

test('--public-key never treats a path as a key file', () => {
  const root = makeRoot();
  const { installer, dir } = writeFixture(root);
  const keyFile = path.join(dir, 'updater.pub');
  writeFileSync(keyFile, publicKeyBlob);

  const result = run(root, installer, ['--public-key', keyFile]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /signature check failed:/);
});

test('the two public key options are mutually exclusive', () => {
  const root = makeRoot();
  const { installer, dir } = writeFixture(root);

  const result = run(root, installer, [
    '--public-key',
    publicKeyBlob,
    '--public-key-file',
    path.join(dir, 'updater.pub'),
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mutually exclusive/);
});

test('a --public-key-file that names a directory fails instead of falling back', () => {
  const root = makeRoot();
  const { installer, dir } = writeFixture(root);

  const result = run(root, installer, ['--public-key-file', dir]);

  assert.equal(result.status, 1);
  // The filesystem error itself must surface. If EISDIR were swallowed into
  // the literal-key fallback, decoding would fail later with a different
  // message and this assertion would not hold.
  assert.match(result.stderr, /signature check failed: .*EISDIR/);
  assert.equal(JSON.parse(result.stdout).passed, false);
});
