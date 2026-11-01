import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-boundaries.mjs');

// Fixture tokens are assembled at runtime so this test file itself passes the
// repo-wide embedded-dolt and banned-license scans.
const EMBEDDED_DOLT = ['embedded', 'dolt'].join('');
const BANNED_SPDX = ['AGPL', '3.0-only'].join('-');

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

test('braced process imports outside bridge fail', () => {
  const root = makeRoot({
    'src-tauri/src/sync/follow.rs': 'use std::process::{Command, Stdio};\n',
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /rust-process-spawn/);
});

test('whitespace around :: does not evade the process rule', () => {
  const root = makeRoot({
    'src-tauri/src/sync/follow.rs': 'use std :: process :: Command;\n',
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /rust-process-spawn/);
});

test('references to the embedded dolt store fail', () => {
  const root = makeRoot({
    'src-tauri/src/sync/reader.rs': `const STORE: &str = ".beads/${EMBEDDED_DOLT}";\n`,
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /embedded-dolt-access/);
});

test('embedded dolt references in tests are caught', () => {
  const root = makeRoot({
    'tests/helper.ts': `export const store = '.beads/${EMBEDDED_DOLT}';\n`,
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /tests\/helper\.ts:1.*embedded-dolt-access/);
});

test('next imports in src fail', () => {
  const root = makeRoot({
    'src/app/App.tsx': "import Link from 'next/link';\nexport const App = Link;\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /forbidden-import/);
});

test('side-effect imports of reference packages fail', () => {
  const root = makeRoot({
    'src/app/App.tsx': "import 'next/link';\nexport const App = 1;\n",
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

test('require of reference packages fails', () => {
  const root = makeRoot({
    'src/lib/legacy.cjs': "const x = require('next/link');\nmodule.exports = x;\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /forbidden-import/);
});

test('child_process imports in the frontend fail', () => {
  const root = makeRoot({
    'src/lib/run.ts': "import { spawn } from 'node:child_process';\nexport const run = spawn;\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /frontend-process-spawn/);
});

test('dynamic child_process imports fail', () => {
  const root = makeRoot({
    'src/lib/dynamic.ts': `const cp = await import('node:child_process');\nexport { cp };\n`,
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /frontend-process-spawn/);
});

test('jsx files are scanned', () => {
  const root = makeRoot({
    'src/legacy.jsx': "import { spawn } from 'node:child_process';\nexport const s = spawn;\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /frontend-process-spawn/);
});

test('copied code with a banned license marker fails', () => {
  const root = makeRoot({
    'src/components/borrowed.tsx': `// SPDX-License-Identifier: ${BANNED_SPDX}\nexport const x = 1;\n`,
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /banned-license/);
});

test('banned license markers in tests are caught', () => {
  const root = makeRoot({
    'tests/helper.ts': `// SPDX-License-Identifier: ${BANNED_SPDX}\nexport const x = 1;\n`,
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /tests\/helper\.ts:1.*banned-license/);
});

test('the current repository is clean', () => {
  const result = run();

  assert.equal(result.status, 0, result.stdout + result.stderr);
});
