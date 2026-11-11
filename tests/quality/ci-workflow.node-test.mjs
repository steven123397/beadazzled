import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readJson } from '../../scripts/lib/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(root, '.github', 'workflows', 'ci.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const packageJson = readJson(root, 'package.json');

function section(start, end) {
  const startIndex = workflow.indexOf(`  ${start}:`);
  if (startIndex === -1) return '';
  const endIndex = end === undefined ? -1 : workflow.indexOf(`  ${end}:`, startIndex + 1);
  return workflow.slice(startIndex, endIndex === -1 ? undefined : endIndex);
}

const frontend = section('frontend', 'rust');
const rust = section('rust', 'quality');
const quality = section('quality');

function assertInOrder(text, commands) {
  let previous = -1;
  for (const command of commands) {
    const index = text.indexOf(command);
    assert.ok(index !== -1, `workflow is missing ${command}`);
    assert.ok(index > previous, `${command} runs out of order`);
    previous = index;
  }
}

function powerShellBlocks(text = workflow) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s+)run: \|\s*$/);
    if (match === null) continue;
    const contentIndent = `${match[1]}  `;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() !== '' && !line.startsWith(contentIndent)) {
        index -= 1;
        break;
      }
      block.push(line.trim() === '' ? '' : line.slice(contentIndent.length));
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

test('CI keeps the same pull request and main push triggers on Windows', () => {
  assert.match(workflow, /^on:/m);
  assert.match(workflow, /^\s{2}pull_request:/m);
  assert.match(workflow, /^\s+-\s+main$/m);
  assert.doesNotMatch(workflow, /^\s{2}workflow_dispatch:/m);
  assert.match(frontend, /runs-on:\s*windows-latest/);
  assert.match(frontend, /fetch-depth:\s*0/);
  assert.match(rust, /runs-on:\s*windows-latest/);
  assert.equal(workflow.match(/timeout-minutes:\s*45/g)?.length, 3);
});

test('Rust and frontend run in parallel behind the same named aggregate gate', () => {
  const jobsYaml = workflow.split(/^jobs:\s*$/m)[1] ?? '';
  const jobIds = [...jobsYaml.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]);
  assert.deepEqual(jobIds, ['frontend', 'rust', 'quality']);
  assert.notEqual(frontend, '');
  assert.notEqual(rust, '');
  assert.doesNotMatch(frontend, /^\s+needs:/m);
  assert.doesNotMatch(rust, /^\s+needs:/m);
  assert.match(quality, /name:\s*Quality gates \(Windows\)/);
  assert.match(quality, /needs:\s*\[frontend, rust\]/);
  assert.match(quality, /if:\s*always\(\)/);
  assert.match(quality, /FRONTEND_RESULT:\s*\$\{\{ needs\.frontend\.result \}\}/);
  assert.match(quality, /RUST_RESULT:\s*\$\{\{ needs\.rust\.result \}\}/);
  assert.match(quality, /Where-Object \{ \$_.Value -ne 'success' \}/);
  assert.match(quality, /exit 1/);
  assert.equal(workflow.match(/name:\s*Quality gates \(Windows\)/g)?.length, 1);
});

test('every existing blocking gate remains present exactly once', () => {
  for (const gate of [
    'npm run check:fast',
    'npm run format:check',
    'npm run build',
    'npm run check:bundle',
    'npm run check:boundaries',
    'npm run test:quality',
    'npm run test:unit',
    'npm run e2e',
    'npm run check:deps',
  ]) {
    assert.ok(frontend.includes(gate), `frontend is missing ${gate}`);
    assert.equal(workflow.split(gate).length - 1, 1, `${gate} must run exactly once`);
  }
  for (const gate of [
    'npm run check:bindings',
    'npm run check:rust:style',
    'npm run test:rust:coverage',
  ]) {
    assert.ok(rust.includes(gate), `rust is missing ${gate}`);
    assert.equal(workflow.split(gate).length - 1, 1, `${gate} must run exactly once`);
  }
  assert.doesNotMatch(workflow, /npm run check:task/);

  for (const script of [
    'check:fast',
    'format:check',
    'check:rust:style',
    'check:bindings',
    'check:boundaries',
    'test:quality',
    'test:unit',
    'test:rust:coverage',
    'check:deps',
    'build',
    'check:bundle',
    'e2e',
  ]) {
    assert.equal(typeof packageJson.scripts[script], 'string', `package.json is missing ${script}`);
  }
});

test('Rust keeps bindings before style and coverage without an npm install', () => {
  assertInOrder(rust, [
    'npm run check:bindings',
    'npm run check:rust:style',
    'npm run test:rust:coverage',
  ]);
  assert.doesNotMatch(rust, /^\s+run:\s*npm ci\s*$/m);
  assert.ok(frontend.includes('npm ci'));

  const taskChecks = packageJson.scripts['check:task'] ?? '';
  assert.match(
    taskChecks,
    /^npm run check:bindings && /,
    'the local sequential check:task must also check bindings first'
  );
});

test('frontend build precedes bundle checks and browser E2E remains gated', () => {
  assertInOrder(frontend, ['npm run build', 'npm run check:bundle', 'npm run e2e']);
  assert.ok(frontend.includes('npx playwright install chromium'));
});

test('CI pins and verifies gitleaks and osv-scanner in the frontend job', () => {
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
    assert.ok(frontend.includes(pin), `frontend is missing ${pin}`);
  }
  const verification = frontend.slice(
    frontend.indexOf('- name: Verify external tools'),
    frontend.indexOf('- name: Install npm dependencies')
  );
  assert.match(verification, /\$PSNativeCommandUseErrorActionPreference = \$true/);
});

test('cargo-llvm-cov uses an exact-version cache and verifies restored binaries', () => {
  assert.match(rust, /rustup component add rustfmt clippy llvm-tools-preview/);
  assert.match(rust, /actions\/cache@0057852bfaa89a56745cba8c7296529d2fc39830\s+# v4\.3\.0/);
  assert.match(rust, /path:\s*~\/\.cargo\/bin\/cargo-llvm-cov\.exe/);
  assert.match(
    rust,
    /key:\s*\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-cargo-llvm-cov-0\.9\.1/
  );
  assert.match(rust, /if:\s*steps\.llvm-cov-cache\.outputs\.cache-hit != 'true'/);
  assert.match(rust, /cargo install cargo-llvm-cov --version 0\.9\.1 --locked/);
  assert.match(rust, /cargo llvm-cov --version/);
});

test('CI pins all JavaScript actions to full official commit SHAs', () => {
  assert.equal(
    workflow.match(/actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/g)?.length,
    2
  );
  assert.equal(
    workflow.match(/actions\/setup-node@a0853c24544627f65ddf259abe73b1d18a591444/g)?.length,
    2
  );
  assert.doesNotMatch(workflow, /uses:\s*actions\/(?:checkout|setup-node|cache)@v\d/);
  assert.match(frontend, /node-version:\s*24/);
  assert.match(rust, /node-version:\s*24/);
});

test('aggregate PowerShell succeeds only when both parallel gates succeed', () => {
  const [script] = powerShellBlocks(quality);
  assert.ok(script, 'aggregate PowerShell block is missing');
  for (const [frontendResult, rustResult, expected] of [
    ['success', 'success', 0],
    ['failure', 'success', 1],
    ['success', 'failure', 1],
    ['cancelled', 'success', 1],
  ]) {
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, FRONTEND_RESULT: frontendResult, RUST_RESULT: rustResult },
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      expected,
      `${frontendResult}/${rustResult}: ${result.stdout}${result.stderr}`
    );
  }
});

test('embedded PowerShell blocks parse without executing them', () => {
  const blocks = powerShellBlocks();
  assert.ok(blocks.length >= 3, 'expected CI PowerShell blocks');
  const parser = `
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseInput(
      $env:CI_WORKFLOW_SCRIPT,
      [ref]$tokens,
      [ref]$errors
    ) | Out-Null
    if ($errors.Count -gt 0) {
      $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }
      exit 1
    }
  `;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', parser], {
    env: { ...process.env, CI_WORKFLOW_SCRIPT: blocks.join('\n\n') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
