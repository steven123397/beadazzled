import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/check-bundle-budget.mjs');

const tempRoots = [];

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'beadazzled-budget-'));
  tempRoots.push(root);
  return root;
}

function writeFile(root, relative, contents) {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function page(scripts, preloads = []) {
  const tags = [
    ...scripts.map((src) => `<script type="module" crossorigin src="${src}"></script>`),
    ...preloads.map((href) => `<link rel="modulepreload" crossorigin href="${href}">`),
  ];
  return `<!doctype html><html><head>${tags.join('')}</head><body><div id="root"></div></body></html>`;
}

// Random bytes do not compress, so the gzip size tracks the byte count. A
// repeating pattern would shrink to almost nothing and hide the failure.
function incompressible(bytes) {
  return randomBytes(bytes);
}

function run(root) {
  return spawnSync(process.execPath, [scriptPath, '--root', root], { encoding: 'utf8' });
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

test('a first screen under the budget passes and reports its size', () => {
  const root = makeRoot();
  writeFile(root, 'dist/assets/index.js', incompressible(10 * 1024));
  writeFile(root, 'dist/index.html', page(['/assets/index.js']));

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /first screen is .* gzip/);
});

test('an oversized first screen fails and names the file', () => {
  const root = makeRoot();
  writeFile(root, 'dist/assets/index.js', incompressible(160 * 1024));
  writeFile(root, 'dist/index.html', page(['/assets/index.js']));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /over the .* budget/);
  assert.match(result.stdout, /assets\/index\.js/);
});

test('route chunks that index.html does not preload are not counted', () => {
  const root = makeRoot();
  writeFile(root, 'dist/assets/index.js', incompressible(10 * 1024));
  writeFile(root, 'dist/assets/board.js', incompressible(400 * 1024));
  writeFile(root, 'dist/index.html', page(['/assets/index.js']));

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /board\.js/);
});

test('a preloaded chunk counts toward the first screen', () => {
  const root = makeRoot();
  writeFile(root, 'dist/assets/index.js', incompressible(10 * 1024));
  writeFile(root, 'dist/assets/vendor.js', incompressible(400 * 1024));
  writeFile(root, 'dist/index.html', page(['/assets/index.js'], ['/assets/vendor.js']));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /assets\/vendor\.js/);
});

test('a reference outside dist is refused instead of read', () => {
  const root = makeRoot();
  writeFile(root, 'secret.js', incompressible(1024));
  writeFile(root, 'dist/index.html', page(['/../secret.js']));

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /outside dist/);
});

test('a missing dist fails with the build instruction', () => {
  const root = makeRoot();

  const result = run(root);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /npm run build/);
});
