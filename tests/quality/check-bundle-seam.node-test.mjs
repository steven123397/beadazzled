import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-bundle-seam.mjs');

const tempRoots = [];

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-seam-'));
  tempRoots.push(root);
  return root;
}

function writeBundle(root, name, contents) {
  const directory = path.join(root, 'dist/assets');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, name), contents);
}

function run(root) {
  return spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test('a production bundle without the e2e seam passes', () => {
  const root = makeRoot();
  writeBundle(root, 'index-abc.js', 'const app = "beadazzled";');

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /free of __BEADAZZLED_E2E__/);
});

test('a bundle carrying the seam marker fails and names the file', () => {
  const root = makeRoot();
  writeBundle(root, 'index-abc.js', 'const app = "beadazzled";');
  writeBundle(root, 'leaky.js', 'if (window.__BEADAZZLED_E2E__) {}');

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /leaky\.js/);
});

test('a missing dist fails with the build instruction', () => {
  const root = makeRoot();

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /npm run build/);
});