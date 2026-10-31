import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-size.mjs');

const tempRoots = [];

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-size-'));
  tempRoots.push(root);
  return root;
}

function writeInstaller(root, name, bytes) {
  const filePath = path.join(root, 'src-tauri/target/release/bundle/nsis', name);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const fd = openSync(filePath, 'w');
  try {
    writeSync(fd, Buffer.alloc(1024));
    if (bytes > 1024) {
      ftruncateSync(fd, bytes);
    }
  } finally {
    closeSync(fd);
  }
}

function run(root) {
  return spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test('missing installer fails with a clear instruction', () => {
  const root = makeRoot();

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /build:app/);
});

test('installer within the 15 MB budget passes', () => {
  const root = makeRoot();
  writeInstaller(root, 'beadazzled_0.1.0_x64-setup.exe', 8 * 1024 * 1024);

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /8\.00 MB/);
});

test('installer over the 15 MB budget fails', () => {
  const root = makeRoot();
  writeInstaller(root, 'beadazzled_0.1.0_x64-setup.exe', 15 * 1024 * 1024 + 1);

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /exceeds|budget/i);
});
