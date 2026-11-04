import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/verify-release.mjs');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyId = randomBytes(8);
const publicKeyBlob = Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64');

const tempRoots = [];

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-release-'));
  tempRoots.push(root);
  return root;
}

function signatureBlob(data) {
  const digest = createHash('blake2b512').update(data).digest();
  return Buffer.concat([Buffer.from('ED'), keyId, sign(null, digest, privateKey)]).toString(
    'base64'
  );
}

function writeFixture(root, overrides = {}) {
  const version = overrides.version ?? '0.1.0';
  const manifestVersion = overrides.manifestVersion ?? version;
  const installerName = overrides.installerName ?? `beadazzled_${version}_x64-setup.exe`;
  const bytes = overrides.bytes ?? Buffer.from('installer bytes');
  const signature = overrides.signature ?? signatureBlob(bytes);
  const dir = path.join(root, 'release');
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  mkdirSync(dir, { recursive: true });

  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "beadazzled"\nversion = "${version}"\n`
  );
  writeFileSync(
    path.join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ version, plugins: { updater: { pubkey: publicKeyBlob } } })
  );

  const installer = path.join(dir, installerName);
  writeFileSync(installer, bytes);
  writeFileSync(`${installer}.sig`, signature);
  writeFileSync(
    path.join(dir, 'latest.json'),
    JSON.stringify({
      version: manifestVersion,
      notes: 'Release notes',
      pub_date: '2026-11-04T00:00:00Z',
      platforms: {
        'windows-x86_64': {
          signature,
          url: `https://github.com/steven123397/beadazzled/releases/download/v${manifestVersion}/${installerName}`,
        },
      },
    })
  );

  return { installer, dir };
}

function run(root, installer, extra = []) {
  return spawnSync(
    process.execPath,
    [scriptPath, '--root', root, '--installer', installer, '--json', ...extra],
    { encoding: 'utf8' }
  );
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

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
