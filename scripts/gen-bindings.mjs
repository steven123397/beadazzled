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
import { parseRootArg, runCheck } from './lib/paths.mjs';

function countPassedTests(output) {
  return [...output.matchAll(/test result: ok\. (\d+) passed/g)].reduce(
    (total, match) => total + Number(match[1]),
    0
  );
}

runCheck('gen-bindings', () => {
  const root = parseRootArg(process.argv.slice(2));
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
});
