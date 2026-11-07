import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { scriptFor, withTempRoots } from './helpers.mjs';

const scriptPath = scriptFor('check-bundle-seam');
const { makeRoot, run } = withTempRoots({ prefix: 'beadazzled-seam-', scriptPath });

function writeBundle(root, name, contents) {
  const directory = path.join(root, 'dist/assets');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, name), contents);
}

test('a production bundle without the e2e seam passes', () => {
  const root = makeRoot();
  writeBundle(root, 'index-abc.js', 'const app = "beadazzled";');

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /free of __BEADAZZLED_E2E__/);
});

test('a bundle carrying the seam marker fails and names the file', () => {
  const root = makeRoot();
  writeBundle(root, 'index-abc.js', 'const app = "beadazzled";');
  writeBundle(root, 'leaky.js', 'if (window.__BEADAZZLED_E2E__) {}');

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /leaky\.js/);
});

test('a missing dist fails with the build instruction', () => {
  const root = makeRoot();

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /npm run build/);
});