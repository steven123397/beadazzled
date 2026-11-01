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
    const manifest = path.join(root, 'src-tauri', 'Cargo.toml');
    const fakeBd = buildFakeBd(manifest);

    const stdout = runCargo(['llvm-cov', '--manifest-path', manifest, '--json'], 'cargo llvm-cov', {
      env: { ...process.env, FAKE_BD_PATH: fakeBd },
    });
    const evaluation = evaluateBridgeCoverage(JSON.parse(stdout));
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

function runCargo(args, label, options = {}) {
  const result = spawnSync('cargo', args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
    ...options,
  });

  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${label} exited with status ${result.status}`);
  }

  return result.stdout ?? '';
}

// cargo-llvm-cov runs tests with `cargo test --tests`, which does not build
// examples. The bridge process tests spawn examples/fake_bd, so build it in the
// default target directory and tell the tests where it is.
function buildFakeBd(manifest) {
  const metadata = JSON.parse(
    runCargo(
      ['metadata', '--manifest-path', manifest, '--format-version', '1', '--no-deps'],
      'cargo metadata'
    )
  );
  if (!metadata.target_directory) {
    throw new Error('cargo metadata did not report target_directory');
  }

  runCargo(
    ['build', '--manifest-path', manifest, '--example', 'fake_bd'],
    'cargo build --example fake_bd'
  );

  const file = process.platform === 'win32' ? 'fake_bd.exe' : 'fake_bd';
  return path.join(metadata.target_directory, 'debug', 'examples', file);
}
