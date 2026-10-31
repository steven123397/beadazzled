import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateBridgeCoverage } from '../../scripts/lib/bridge-coverage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-bridge-coverage.mjs');

const tempRoots = [];

function report(files) {
  return {
    data: [
      {
        files: files.map(([filename, count, covered]) => ({
          filename,
          summary: { lines: { count, covered } },
        })),
      },
    ],
  };
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test('coverage at the threshold passes', () => {
  const result = evaluateBridgeCoverage(
    report([['D:\\repo\\src-tauri\\src\\bridge\\mod.rs', 100, 80]]),
    80
  );

  assert.equal(result.status, 'pass');
  assert.equal(result.percent, 80);
});

test('coverage below the threshold fails', () => {
  const result = evaluateBridgeCoverage(report([['src-tauri/src/bridge/argv.rs', 100, 79]]), 80);

  assert.equal(result.status, 'fail');
});

test('only bridge files count toward the threshold', () => {
  const result = evaluateBridgeCoverage(
    report([
      ['src-tauri/src/bridge/argv.rs', 10, 10],
      ['src-tauri/src/sync/follow.rs', 1000, 0],
      ['src/lib/utils.ts', 100, 0],
    ]),
    80
  );

  assert.equal(result.fileCount, 1);
  assert.equal(result.lines, 10);
  assert.equal(result.covered, 10);
  assert.equal(result.status, 'pass');
});

test('a bridge module file at the crate root is counted', () => {
  const result = evaluateBridgeCoverage(report([['src-tauri/src/bridge.rs', 10, 10]]), 80);

  assert.equal(result.status, 'pass');
});

test('no bridge sources is not applicable', () => {
  const result = evaluateBridgeCoverage(report([['src-tauri/src/lib.rs', 10, 10]]), 80);

  assert.equal(result.status, 'not-applicable');
  assert.equal(result.percent, null);
});

test('the CLI reports not applicable when the bridge module does not exist', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-bridge-cov-'));
  tempRoots.push(root);

  const result = spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /no bridge sources/i);
});
