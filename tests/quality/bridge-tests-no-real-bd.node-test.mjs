import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const testsDir = path.join(root, 'src-tauri', 'tests');

// Conventional forms that would spawn the real bd from a test.
const FORBIDDEN = [
  /Command\s*::\s*new\s*\(\s*"bd(?:\.exe)?"/,
  /ProcessRunner\s*::\s*new\s*\(\s*"bd(?:\.exe)?"/,
  /spawn\s*\(\s*"bd(?:\.exe)?"/,
];

test('bridge tests never spawn the real bd', () => {
  const files = readdirSync(testsDir, { recursive: true })
    .filter((file) => file.endsWith('.rs'))
    .map((file) => path.join(testsDir, file));

  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (FORBIDDEN.some((pattern) => pattern.test(text))) {
      offenders.push(path.relative(root, file));
    }
  }

  assert.deepEqual(offenders, []);
});
