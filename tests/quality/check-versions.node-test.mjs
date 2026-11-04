import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-versions.mjs');

const tempRoots = [];

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-versions-'));
  tempRoots.push(root);
  return root;
}

function writeFixture(root, { npm = '0.1.0', cargo = '0.1.0', tauri = '0.1.0' } = {}) {
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: npm }));
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "beadazzled"\nversion = "${cargo}"\nedition = "2021"\n\n[profile.release]\nstrip = true\n`
  );
  writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: tauri }));
}

function run(root) {
  return spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test('matching versions pass', () => {
  const root = makeRoot();
  writeFixture(root);

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /check-versions: 0\.1\.0/);
});

test('a Cargo version drift fails and names the sources', () => {
  const root = makeRoot();
  writeFixture(root, { cargo: '0.1.1' });

  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src-tauri\/Cargo\.toml is 0\.1\.1/);
  assert.match(result.stderr, /package\.json is 0\.1\.0/);
  assert.match(result.stderr, /must match/);
});

test('a tauri.conf drift fails', () => {
  const root = makeRoot();
  writeFixture(root, { tauri: '0.2.0' });

  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src-tauri\/tauri\.conf\.json is 0\.2\.0/);
});

test('a malformed version fails instead of comparing strings', () => {
  const root = makeRoot();
  writeFixture(root, { npm: 'v0.1', cargo: 'v0.1', tauri: 'v0.1' });

  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed version "v0\.1"/);
});
