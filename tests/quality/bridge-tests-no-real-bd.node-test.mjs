import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The process-layer tests live inside src-tauri/src/bridge since process and
// parse are private (bza-ryr.25), so the scan has to cover both trees.
const SCANNED_DIRECTORIES = [
  path.join(root, 'src-tauri', 'tests'),
  path.join(root, 'src-tauri', 'src', 'bridge'),
];

// Conventional forms that would spawn the real bd from a test.
const FORBIDDEN = [
  /Command\s*::\s*new\s*\(\s*"bd(?:\.exe)?"/,
  /ProcessRunner\s*::\s*new\s*\(\s*"bd(?:\.exe)?"/,
  /spawn\s*\(\s*"bd(?:\.exe)?"/,
];

test('bridge tests never spawn the real bd', () => {
  const files = SCANNED_DIRECTORIES.flatMap((directory) =>
    readdirSync(directory, { recursive: true })
      .filter((file) => file.endsWith('.rs'))
      .map((file) => path.join(directory, file))
  );

  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (FORBIDDEN.some((pattern) => pattern.test(text))) {
      offenders.push(path.relative(root, file));
    }
  }

  assert.deepEqual(offenders, []);
});

test('the bridge process and parse modules stay private', () => {
  const source = readFileSync(path.join(root, 'src-tauri', 'src', 'bridge', 'mod.rs'), 'utf8');

  assert.match(source, /^mod process;$/m, 'bridge::process must stay private');
  assert.match(source, /^mod parse;$/m, 'bridge::parse must stay private');
  assert.doesNotMatch(source, /^pub mod (?:process|parse);$/m);
});
