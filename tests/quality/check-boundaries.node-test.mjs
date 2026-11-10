import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { scriptFor, withTempRoots } from './helpers.mjs';

const scriptPath = scriptFor('check-boundaries');
const { makeRoot: makeBaseRoot, run } = withTempRoots({
  prefix: 'beadazzled-boundaries-',
  scriptPath,
});

// Fixture tokens are assembled at runtime so this test file itself passes the
// repo-wide embedded-dolt and banned-license scans.
const EMBEDDED_DOLT = ['embedded', 'dolt'].join('');
const BANNED_SPDX = ['AGPL', '3.0-only'].join('-');

function makeRoot(files) {
  const root = makeBaseRoot();
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return root;
}

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

test('bridge internals outside the bridge module fail', () => {
  const root = makeRoot({
    'src-tauri/src/sync/follow.rs': 'use crate::bridge::process::ProcessRunner;\n',
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bridge-internal-api/);
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

test('lib/store imports from lib/sync fail through aliases and relative paths', () => {
  const root = makeRoot({
    'src/lib/store/alias.ts': "import { createTicketState } from '@/lib/sync/reducer';\n",
    'src/lib/store/relative.ts': "import { createTicketState } from '../sync/reducer';\n",
    'src/lib/store/nested/relative.ts':
      "import { createTicketState } from '../../../lib/sync/reducer';\n",
  });

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /alias\.ts:1.*lib-store-to-sync/);
  assert.match(result.stdout, /relative\.ts:1.*lib-store-to-sync/);
  assert.match(result.stdout, /nested\/relative\.ts:1.*lib-store-to-sync/);
});

test('lib/store can import neutral issues and records leaves', () => {
  const root = makeRoot({
    'src/lib/store/selectors.ts':
      "import { indexById } from '@/lib/issues';\nimport { emptyRecord } from '@/lib/records';\nimport { helper } from '@/lib/sync-foo';\n",
  });

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
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
