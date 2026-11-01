#!/usr/bin/env node
// Regenerates src/bindings/bd.ts through the `export_bindings` Rust test.
//
// `cargo test <filter>` exits 0 when the filter matches no tests, so the old
// `gen:bindings` script could silently write nothing. This wrapper fails when
// no test ran and verifies the generated file is non-empty before reporting
// success.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');

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

function countPassedTests(output) {
  return [...output.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
    (total, match) => total + Number(match[1]),
    0
  );
}

try {
  const root = parseRoot(process.argv.slice(2));
  const manifest = path.join(root, 'src-tauri', 'Cargo.toml');

  const result = spawnSync('cargo', ['test', '--manifest-path', manifest, 'export_bindings'], {
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.error) {
    throw new Error(`cargo could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.stderr.write(output);
    throw new Error(`cargo test exited with status ${result.status}`);
  }

  const passed = countPassedTests(output);
  if (passed < 1) {
    throw new Error('the export_bindings filter matched no tests; bindings were not regenerated');
  }

  const bindings = path.join(root, 'src', 'bindings', 'bd.ts');
  if (!existsSync(bindings) || readFileSync(bindings, 'utf8').trim() === '') {
    throw new Error(`bindings file is missing or empty: ${bindings}`);
  }

  console.log(`gen-bindings: regenerated ${path.relative(root, bindings)} (${passed} test passed)`);
} catch (error) {
  console.error(`gen-bindings: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
