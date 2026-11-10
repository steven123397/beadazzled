import assert from 'node:assert/strict';
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { scriptFor, withTempRoots } from './helpers.mjs';

const scriptPath = scriptFor('check-size');
const { makeRoot, run } = withTempRoots({ prefix: 'beadazzled-size-', scriptPath });

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
