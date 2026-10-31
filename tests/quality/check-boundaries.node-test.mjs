import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-boundaries.mjs');

const tempRoots = [];

function makeRoot(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-boundaries-'));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return root;
}

function run(root) {
  const args = root === undefined ? [scriptPath] : [scriptPath, '--root', root];
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test('clean tree passes', () => {
  const root = makeRoot({
    'src-tauri/src/bridge/runner.rs':
      'use std::process::Command;\nfn run() {\n    let _ = Command::new("bd");\n}\n',
    'src/app/App.tsx': 'export function App() {\n  return null;\n}\n',
  });

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /check-boundaries: clean/);
});

test('process spawn outside bridge fails', () => {
  const root = makeRoot({
    'src-tauri/src/sync/follow.rs':
      'use std::process::Command;\nfn poll() {\n    let _ = Command::new("bd");\n}\n',
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /sync\/follow\.rs:1/);
  assert.match(result.stdout, /rust-process-spawn/);
});

test('references to the embedded dolt store fail', () => {
  const root = makeRoot({
    'src-tauri/src/sync/reader.rs': 'const STORE: &str = ".beads/embeddeddolt";\n',
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /embedded-dolt-access/);
});

test('next imports in src fail', () => {
  const root = makeRoot({
    'src/app/App.tsx': "import Link from 'next/link';\nexport const App = Link;\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /forbidden-import/);
});

test('nuqs and mock-data imports in src fail', () => {
  const root = makeRoot({
    'src/app/filters.ts':
      "import { useQueryState } from 'nuqs';\nexport const filter = useQueryState;\n",
    'src/app/mock.ts': "import { issues } from '@/mock-data';\nexport const all = issues;\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /filters\.ts:1.*forbidden-import/);
  assert.match(result.stdout, /mock\.ts:1.*forbidden-import/);
});

test('child_process imports in the frontend fail', () => {
  const root = makeRoot({
    'src/lib/run.ts': "import { spawn } from 'node:child_process';\nexport const run = spawn;\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /frontend-process-spawn/);
});

test('copied code with a banned license marker fails', () => {
  const root = makeRoot({
    'src/components/borrowed.tsx':
      '// SPDX-License-Identifier: AGPL-3.0-only\nexport const x = 1;\n',
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /banned-license/);
});

test('the current repository is clean', () => {
  const result = run();

  assert.equal(result.status, 0, result.stdout + result.stderr);
});
