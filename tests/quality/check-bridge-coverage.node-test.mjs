import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  evaluateBridgeCoverage,
  isBridgeSource,
  listBridgeSourceFiles,
} from '../../scripts/lib/bridge-coverage.mjs';
import { scriptFor, withTempRoots } from './helpers.mjs';

const scriptPath = scriptFor('check-bridge-coverage');
const { makeRoot, run } = withTempRoots({
  prefix: 'beadazzled-bridge-cov-',
  scriptPath,
});

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

test('a single-file bridge module is discovered as a bridge source', () => {
  const root = makeRoot();
  mkdirSync(path.join(root, 'src-tauri', 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src-tauri', 'src', 'bridge.rs'), 'pub fn run() {}\n');

  const files = listBridgeSourceFiles(root);

  assert.equal(files.length, 1);
  assert.match(files[0], /bridge\.rs$/);
});

test('non-bridge Rust files are not discovered', () => {
  const root = makeRoot();
  mkdirSync(path.join(root, 'src-tauri', 'src', 'sync'), { recursive: true });
  writeFileSync(path.join(root, 'src-tauri', 'src', 'sync', 'follow.rs'), 'pub fn poll() {}\n');

  assert.deepEqual(listBridgeSourceFiles(root), []);
});

test('no bridge sources is not applicable', () => {
  const result = evaluateBridgeCoverage(report([['src-tauri/src/lib.rs', 10, 10]]), 80);

  assert.equal(result.status, 'not-applicable');
  assert.equal(result.percent, null);
});

test('the CLI reports not applicable when the bridge module does not exist', () => {
  const root = makeRoot();

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /no bridge sources/i);
});

test('test-only bridge modules do not count toward coverage', () => {
  assert.equal(isBridgeSource('src-tauri/src/bridge/test_support.rs'), false);
  assert.equal(isBridgeSource('src-tauri/src/bridge/process/bridge_tests.rs'), false);
  assert.equal(isBridgeSource('src-tauri/src/bridge/parse/tests.rs'), false);
  assert.equal(isBridgeSource('src-tauri/src/bridge/process.rs'), true);
});
