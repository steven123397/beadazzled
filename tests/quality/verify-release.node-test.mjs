import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTempRoots, writeFixture } from './release-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/verify-release.mjs');

const { makeRoot, cleanup } = createTempRoots('beadazzled-release-');
afterEach(cleanup);

function run(root, installer, extra = []) {
  return spawnSync(
    process.execPath,
    [scriptPath, '--root', root, '--installer', installer, '--json', ...extra],
    { encoding: 'utf8' }
  );
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
  assert.match(result.stderr, /names other\.exe/);
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
