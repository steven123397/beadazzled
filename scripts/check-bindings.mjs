#!/usr/bin/env node
// Fails when src/bindings/bd.ts is out of date with the ts-rs definitions.
//
// The `export_bindings` Rust test rewrites the file every time `cargo test`
// runs, so a `git diff` after the test suite always looks clean. This check
// snapshots the committed file, regenerates in place, compares the two, and
// restores the snapshot: the working tree is never left modified, and a
// failing check cannot make the next run pass.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareBindings } from './lib/bindings.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const MAX_LISTED_LINES = 5;

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

function printLines(prefix, lines) {
  for (const line of lines.slice(0, MAX_LISTED_LINES)) {
    console.log(`  ${prefix} ${line}`);
  }
  if (lines.length > MAX_LISTED_LINES) {
    console.log(`  ${prefix} ... ${lines.length - MAX_LISTED_LINES} more`);
  }
}

try {
  const root = parseRoot(process.argv.slice(2));
  const bindings = path.join(root, 'src', 'bindings', 'bd.ts');
  const relativePath = path.relative(root, bindings);

  if (!existsSync(bindings)) {
    throw new Error(
      `bindings file is missing: ${relativePath}; run npm run gen:bindings and commit it`
    );
  }

  const committed = readFileSync(bindings, 'utf8');
  const before = statSync(bindings);
  const generator = path.join(root, 'scripts', 'gen-bindings.mjs');
  const result = spawnSync(process.execPath, [generator, '--root', root], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const generated = result.status === 0 ? readFileSync(bindings, 'utf8') : committed;

  // Restore the snapshot even when generation failed: the check must not
  // mutate the tree, and a partial write would hide the next drift. The
  // timestamps come back too, so a check run cannot make the file look newer
  // than a build that already included it (measure-startup uses mtimes).
  writeFileSync(bindings, committed);
  utimesSync(bindings, before.atime, before.mtime);

  if (result.error) {
    throw new Error(`generator could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`generator exited with status ${result.status}: ${output.trim()}`);
  }

  const { drifted, added, removed } = compareBindings(committed, generated);

  if (!drifted) {
    console.log(`check-bindings: ${relativePath} matches the generated output`);
  } else {
    console.log(
      `check-bindings: ${relativePath} is stale ` +
        `(${added.length} added, ${removed.length} removed line(s))`
    );
    printLines('+', added);
    printLines('-', removed);
    console.log('check-bindings: run `npm run gen:bindings` and commit the result');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`check-bindings: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
