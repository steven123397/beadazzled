import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const makeScript = path.join(repoRoot, 'scripts/make-latest-json.mjs');
const verifyScript = path.join(repoRoot, 'scripts/verify-release.mjs');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyId = randomBytes(8);
const publicKeyBlob = Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64');

const tempRoots = [];

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-latest-'));
  tempRoots.push(root);
  return root;
}

function signatureBlob(data) {
  const digest = createHash('blake2b512').update(data).digest();
  return Buffer.concat([Buffer.from('ED'), keyId, sign(null, digest, privateKey)]).toString(
    'base64'
  );
}

function writeRepo(root, version = '0.1.0') {
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "beadazzled"\nversion = "${version}"\n`
  );
  writeFileSync(
    path.join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ version, plugins: { updater: { pubkey: publicKeyBlob } } })
  );
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test('the generated manifest passes verify-release', () => {
  const root = makeRoot();
  writeRepo(root);
  const dir = path.join(root, 'release');
  mkdirSync(dir, { recursive: true });
  const installer = path.join(dir, 'beadazzled_0.1.0_x64-setup.exe');
  const bytes = Buffer.from('installer bytes');
  writeFileSync(installer, bytes);
  writeFileSync(`${installer}.sig`, signatureBlob(bytes));

  const made = spawnSync(
    process.execPath,
    [makeScript, '--root', root, '--installer', installer, '--notes', 'First release'],
    { encoding: 'utf8' }
  );
  assert.equal(made.status, 0, made.stdout + made.stderr);

  const manifest = JSON.parse(readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.notes, 'First release');
  assert.equal(manifest.platforms['windows-x86_64'].signature, signatureBlob(bytes));

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
