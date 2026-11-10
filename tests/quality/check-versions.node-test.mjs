import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { scriptFor, withTempRoots } from './helpers.mjs';

const scriptPath = scriptFor('check-versions');
const { makeRoot, run } = withTempRoots({ prefix: 'beadazzled-versions-', scriptPath });

function writeFixture(root, { npm = '0.1.0', cargo = '0.1.0', tauri = '0.1.0' } = {}) {
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: npm }));
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "beadazzled"\nversion = "${cargo}"\nedition = "2021"\n\n[profile.release]\nstrip = true\n`
  );
  writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: tauri }));
}

test('matching versions pass', () => {
  const root = makeRoot();
  writeFixture(root);

  const result = run(root);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /check-versions: 0\.1\.0/);
});

test('a Cargo version drift fails and names the sources', () => {
  const root = makeRoot();
  writeFixture(root, { cargo: '0.1.1' });

  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src-tauri\/Cargo\.toml is 0\.1\.1/);
  assert.match(result.stderr, /package\.json is 0\.1\.0/);
  assert.match(result.stderr, /must match/);
});

test('a tauri.conf drift fails', () => {
  const root = makeRoot();
  writeFixture(root, { tauri: '0.2.0' });

  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /src-tauri\/tauri\.conf\.json is 0\.2\.0/);
});

test('a malformed version fails instead of comparing strings', () => {
  const root = makeRoot();
  writeFixture(root, { npm: 'v0.1', cargo: 'v0.1', tauri: 'v0.1' });

  const result = run(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed version "v0\.1"/);
});
