import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readJson } from '../../scripts/lib/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const packageJson = readJson(root, 'package.json');

test('CI runs on pull requests and pushes to main on Windows', () => {
  assert.match(workflow, /^on:/m);
  assert.match(workflow, /^\s{2}pull_request:/m);
  assert.match(workflow, /^\s+-\s+main$/m);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /fetch-depth:\s*0/);
});

test('CI runs every blocking gate and the scripts exist', () => {
  const gates = [
    'npm run check:fast',
    'npm run format:check',
    'npm run check:rust:style',
    'npm run build',
    'npm run check:task',
    'npm run check:deps',
  ];

  for (const gate of gates) {
    assert.ok(workflow.includes(gate), `workflow is missing ${gate}`);
  }

  for (const script of [
    'check:fast',
    'format:check',
    'check:rust:style',
    'check:task',
    'check:deps',
    'build',
  ]) {
    assert.equal(typeof packageJson.scripts[script], 'string', `package.json is missing ${script}`);
  }
});

test('bindings drift is checked before any gate that runs cargo tests', () => {
  // The export_bindings test rewrites src/bindings/bd.ts on every cargo test,
  // so the drift check has to run before test:rust:coverage inside check:task.
  const taskChecks = packageJson.scripts['check:task'] ?? '';

  assert.match(
    taskChecks,
    /^npm run check:bindings && /,
    'check:task must run check:bindings first'
  );
  assert.ok(workflow.includes('npm run check:task'), 'workflow is missing npm run check:task');
});

test('CI pins and verifies gitleaks and osv-scanner', () => {
  const pins = [
    'v8.30.1',
    'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
    'v2.7.0',
    '9964ed64ec9a387391eb4cc006ad5c531154821aef29b793e02c448de4686438',
    'GITLEAKS_PATH',
    'OSV_SCANNER_PATH',
    'Get-FileHash',
  ];

  for (const pin of pins) {
    assert.ok(workflow.includes(pin), `workflow is missing ${pin}`);
  }
});

test('CI installs the pinned Rust tools needed by the gates', () => {
  assert.match(workflow, /rustup component add rustfmt clippy llvm-tools-preview/);
  assert.match(workflow, /cargo install cargo-llvm-cov --version 0\.9\.1 --locked/);
});

test('CI uses the Node 24 action majors', () => {
  assert.match(workflow, /uses:\s*actions\/checkout@v5/);
  assert.match(workflow, /uses:\s*actions\/setup-node@v5/);
  assert.doesNotMatch(workflow, /uses:\s*actions\/(?:checkout|setup-node)@v4/);
});
