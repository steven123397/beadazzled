#!/usr/bin/env node
// Enforces the bridge line-coverage threshold from CONSTRAINTS.md using
// cargo-llvm-cov. Vitest coverage cannot see the Rust bridge module, so the
// frontend and bridge thresholds are measured separately (ADR-0003).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateBridgeCoverage, listBridgeSourceFiles } from './lib/bridge-coverage.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const MAX_BUFFER_BYTES = 512 * 1024 * 1024;

function parseRoot(argv) {
  const flagIndex = argv.indexOf('--root');
  if (flagIndex === -1) {
    return defaultRoot;
  }
  const value = argv[flagIndex + 1];
  if (!value) {
    throw new Error('--root requires a directory argument');
  }
  return path.resolve(value);
}

try {
  const root = parseRoot(process.argv.slice(2));

  if (listBridgeSourceFiles(root).length === 0) {
    console.log(
      'check-bridge-coverage: no bridge sources yet; the 80% threshold applies once ' +
        'the bridge module lands (bza-3ej).'
    );
  } else {
    const result = spawnSync(
      'cargo',
      ['llvm-cov', '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml'), '--json'],
      { encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES }
    );

    if (result.error) {
      throw new Error(`cargo llvm-cov could not start: ${result.error.message}`);
    }
    if (result.status !== 0) {
      process.stderr.write(result.stderr ?? '');
      throw new Error(`cargo llvm-cov exited with status ${result.status}`);
    }

    const evaluation = evaluateBridgeCoverage(JSON.parse(result.stdout));
    const percent = evaluation.percent === null ? 'n/a' : evaluation.percent.toFixed(1);
    console.log(
      `check-bridge-coverage: ${percent}% lines (${evaluation.covered}/${evaluation.lines}) ` +
        `across ${evaluation.fileCount} bridge file(s)`
    );

    if (evaluation.status === 'fail') {
      console.error(
        `check-bridge-coverage: below the ${evaluation.threshold}% bridge line-coverage threshold`
      );
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`check-bridge-coverage: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
