import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { compareBindings } from '../../scripts/lib/bindings.mjs';
import { scriptFor, withTempRoots } from './helpers.mjs';

const scriptPath = scriptFor('check-bindings');
const { makeRoot: makeBaseRoot, run } = withTempRoots({
  prefix: 'beadazzled-bindings-',
  scriptPath,
});

// Stands in for scripts/gen-bindings.mjs: writes whatever the test asks for, or
// fails, without needing cargo.
const FAKE_GENERATOR = [
  "import { mkdirSync, writeFileSync } from 'node:fs';",
  "import path from 'node:path';",
  '',
  "const root = process.argv[process.argv.indexOf('--root') + 1];",
  "const exitCode = Number(process.env.FAKE_BINDINGS_EXIT ?? '0');",
  'if (exitCode !== 0) {',
  "  process.stderr.write('fake generator failed\\n');",
  '  process.exit(exitCode);',
  '}',
  "const out = path.join(root, 'src', 'bindings', 'bd.ts');",
  'mkdirSync(path.dirname(out), { recursive: true });',
  "writeFileSync(out, process.env.FAKE_BINDINGS ?? '');",
  '',
].join('\n');

function bindingsPath(root) {
  return path.join(root, 'src', 'bindings', 'bd.ts');
}

function makeRoot(committed) {
  const root = makeBaseRoot();
  if (committed !== null) {
    mkdirSync(path.dirname(bindingsPath(root)), { recursive: true });
    writeFileSync(bindingsPath(root), committed);
  }
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  writeFileSync(path.join(root, 'scripts', 'gen-bindings.mjs'), FAKE_GENERATOR);
  return root;
}

test('identical generated content is not drift', () => {
  assert.deepEqual(compareBindings('a\nb\n', 'a\nb\n'), {
    drifted: false,
    added: [],
    removed: [],
  });
});

test('a CRLF checkout is not drift', () => {
  assert.equal(compareBindings('a\r\nb\r\n', 'a\nb\n').drifted, false);
});

test('added generated lines are reported', () => {
  const result = compareBindings('a\nb\n', 'a\nb\nc\n');

  assert.equal(result.drifted, true);
  assert.deepEqual(result.added, ['c']);
  assert.deepEqual(result.removed, []);
});

test('removed generated lines are reported', () => {
  const result = compareBindings('a\nb\nc\n', 'a\nb\n');

  assert.equal(result.drifted, true);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, ['c']);
});

test('duplicate lines are compared by count', () => {
  const result = compareBindings('a\na\n', 'a\n');

  assert.equal(result.drifted, true);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, ['a']);
});

test('the CLI passes when the committed bindings match', () => {
  const root = makeRoot('type A = string;\n');

  const result = run(root, { FAKE_BINDINGS: 'type A = string;\n' });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /matches the generated output/);
});

test('a CRLF checkout does not fail the CLI and is left untouched', () => {
  const committed = 'type A = string;\r\ntype B = number;\r\n';
  const root = makeRoot(committed);

  const result = run(root, { FAKE_BINDINGS: 'type A = string;\ntype B = number;\n' });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(bindingsPath(root), 'utf8'), committed);
});

test('the CLI fails on drift, reports the lines and restores the file', () => {
  const root = makeRoot('type A = string;\n');

  const result = run(root, { FAKE_BINDINGS: 'type A = number;\ntype B = boolean;\n' });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /stale/);
  assert.match(result.stdout, /\+ type B = boolean;/);
  assert.match(result.stdout, /- type A = string;/);
  assert.match(result.stdout, /npm run gen:bindings/);
  assert.equal(readFileSync(bindingsPath(root), 'utf8'), 'type A = string;\n');
});

test('a failing generator fails the check and restores the file', () => {
  const root = makeRoot('type A = string;\n');

  const result = run(root, { FAKE_BINDINGS_EXIT: '3' });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /generator exited with status 3/);
  assert.match(result.stderr, /fake generator failed/);
  assert.equal(readFileSync(bindingsPath(root), 'utf8'), 'type A = string;\n');
});

test('a missing bindings file fails the check', () => {
  const root = makeRoot(null);

  const result = run(root, { FAKE_BINDINGS: 'type A = string;\n' });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /bindings file is missing/);
});

test('a passing check restores the timestamp as well as the content', async () => {
  const committed = 'type A = string;\n';
  const root = makeRoot(committed);
  const before = statSync(bindingsPath(root)).mtimeMs;
  // Let the clock move so a leftover generator write would be visible.
  await new Promise((resolve) => setTimeout(resolve, 60));

  const result = run(root, { FAKE_BINDINGS: committed });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(bindingsPath(root), 'utf8'), committed);
  const after = statSync(bindingsPath(root)).mtimeMs;
  assert.ok(
    Math.abs(after - before) < 5,
    `check must not bump the mtime: ${before} -> ${after}`
  );
});
