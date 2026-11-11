import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(root, '.github', 'workflows', 'release.yml');
const workflow = readFileSync(workflowPath, 'utf8');

function assertInOrder(commands) {
  let previous = -1;
  for (const command of commands) {
    const index = workflow.indexOf(command);
    assert.ok(index !== -1, `release workflow is missing ${command}`);
    assert.ok(index > previous, `${command} runs out of order`);
    previous = index;
  }
}

function powerShellBlocks() {
  const lines = workflow.split(/\r?\n/);
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

test('embedded PowerShell blocks parse without executing them', () => {
  const blocks = powerShellBlocks();
  assert.ok(blocks.length >= 4, 'expected the release PowerShell blocks');
  const parser = `
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseInput(
      $env:RELEASE_WORKFLOW_SCRIPT,
      [ref]$tokens,
      [ref]$errors
    ) | Out-Null
    if ($errors.Count -gt 0) {
      $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }
      exit 1
    }
  `;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', parser], {
    env: { ...process.env, RELEASE_WORKFLOW_SCRIPT: blocks.join('\n\n') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

test('release is manually dispatched and concurrent runs cannot cancel one another', () => {
  const triggers = workflow.split(/^jobs:/m)[0];
  assert.match(triggers, /^on:\r?\n {2}workflow_dispatch:\s*$/m);
  for (const event of ['push', 'pull_request', 'release', 'schedule', 'workflow_run']) {
    assert.doesNotMatch(triggers, new RegExp(`^ {2}${event}:`, 'm'));
  }
  assert.match(workflow, /^concurrency:\r?\n {2}group: release-/m);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('preflight requires the main branch and its latest CI push run to pass', () => {
  assert.match(workflow, /RELEASE_REF:\s*\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /if \(\$env:RELEASE_REF -ne 'refs\/heads\/main'\)/);
  assert.match(workflow, /--workflow ci\.yml/);
  assert.match(workflow, /--commit "\$env:RELEASE_SHA"/);
  assert.match(workflow, /--event push/);
  assert.match(workflow, /--branch main/);
  assert.match(workflow, /\$latest\.headSha -ne \$env:RELEASE_SHA/);
  assert.match(workflow, /\$latest\.event -ne 'push'/);
  assert.match(workflow, /\$latest\.workflowName -ne 'CI'/);
  assert.match(workflow, /gh run view/);
  assert.match(workflow, /\$quality\.Count -ne 1/);
  assert.match(workflow, /\$quality\[0\]\.conclusion -ne 'success'/);
  assert.match(workflow, /\$latest\.status -ne 'completed'/);
  assert.match(workflow, /\$latest\.conclusion -ne 'success'/);
  assert.match(workflow, /ref:\s*\$\{\{ github\.sha \}\}/);
});

test('permissions and signing secrets are scoped to the jobs that need them', () => {
  assert.match(workflow, /^permissions:\s*\{\}\s*$/m);
  assert.match(workflow, /^\s+actions:\s*read\s*$/m);
  assert.equal(workflow.match(/contents:\s*write/g)?.length, 1);
  assert.match(workflow, /^\s+environment:\s*release\s*$/m);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(
    workflow,
    /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/
  );
  assert.match(
    workflow,
    /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/
  );

  const build = workflow.indexOf('- name: Build signed installer');
  const manifest = workflow.indexOf('- name: Generate and verify updater manifest');
  const privateKey = workflow.indexOf('secrets.TAURI_SIGNING_PRIVATE_KEY }');
  const password = workflow.indexOf('secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }');
  const resolve = workflow.slice(
    workflow.indexOf('- name: Resolve and reserve release metadata'),
    build
  );
  assert.doesNotMatch(resolve, /GH_TOKEN/, 'metadata resolution does not need a write token');
  for (const secret of [privateKey, password]) {
    assert.ok(secret > build && secret < manifest, 'signing secret escapes the build step');
  }
});

test('release builds and verifies the exact installer before creating a release', () => {
  assertInOrder([
    'npm ci',
    'npm run check:versions',
    'npm run build:app',
    'npm run make:latest',
    'npm run verify:release',
    'npm run check:size',
    'gh api --method POST',
    'gh release create',
  ]);
  assert.match(workflow, /beadazzled_\$\{version\}_x64-setup\.exe/);
  assert.match(workflow, /docs\/releases\/\$tag\.md/);
  assert.match(workflow, /Get-FileHash -Algorithm SHA256/);
  assert.match(workflow, /\(\?i\)\\b\[0-9a-f\]\{64\}\\b/);
  assert.match(workflow, /only supports stable x\.y\.z versions/);
  assert.match(workflow, /RELEASE_NOTES_PATH/);
  assert.match(workflow, /--notes-file "\$env:RELEASE_NOTES_PATH"/);
  assert.doesNotMatch(workflow, /--notes "\$notes"/);
});

test('tag creation is atomic and release creation is draft-only', () => {
  assert.match(workflow, /gh api --method POST/);
  assert.match(workflow, /ref=refs\/tags\/\$env:RELEASE_TAG/);
  assert.match(workflow, /sha=\$env:RELEASE_SHA/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /git\/ref\/tags\/\$env:RELEASE_TAG/);
  assert.match(workflow, /\$releasedTag\.object\.sha -ne \$env:RELEASE_SHA/);
  assert.match(workflow, /--draft/);
  assert.doesNotMatch(workflow, /--target/);
  assert.doesNotMatch(workflow, /--clobber/);
  assert.doesNotMatch(workflow, /gh release (?:upload|publish|edit|delete)/);
  assert.doesNotMatch(workflow, /npm run e2e:real/);
});

test('release uses the same Windows and Node 24 toolchain baseline as CI', () => {
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(
    workflow,
    /uses:\s*actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09\s+# v5\.1\.0/
  );
  assert.match(
    workflow,
    /uses:\s*actions\/setup-node@a0853c24544627f65ddf259abe73b1d18a591444\s+# v5\.0\.0/
  );
  assert.doesNotMatch(workflow, /uses:\s*actions\/(?:checkout|setup-node)@v\d/);
  assert.match(workflow, /node-version:\s*24/);
});
