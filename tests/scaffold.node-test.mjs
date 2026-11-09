import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readJson } from '../scripts/lib/paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = readJson(root, 'package.json');

// Every command listed in docs/spec/capability-map.md must be declared in package.json.
const CAPABILITY_MAP_SCRIPTS = [
  'dev',
  'dev:web',
  'typecheck',
  'lint',
  'test:unit',
  'test:rust',
  'gen:bindings',
  'check:bindings',
  'check:boundaries',
  'build',
  'build:app',
  'check:size',
  'e2e',
  'measure:startup',
  'measure:memory',
  'measure:navigation',
  'measure:scroll',
  'verify:release',
];

test('package.json declares a semantic version', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});

test('package.json declares every capability-map command', () => {
  const scripts = pkg.scripts ?? {};
  const missing = CAPABILITY_MAP_SCRIPTS.filter((name) => !scripts[name]);
  assert.deepEqual(missing, []);
});

test('tauri.conf.json carries the product identity', () => {
  const config = readJson(root, 'src-tauri/tauri.conf.json');
  assert.equal(config.productName, 'beadazzled');
  assert.equal(config.version, pkg.version);
  assert.equal(config.identifier, 'com.steven123397.beadazzled');
});

test('Cargo.toml version matches package.json', () => {
  const cargoToml = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const version = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
  assert.equal(version, pkg.version);
});

test('scaffold entry points exist', () => {
  const required = [
    'index.html',
    'vite.config.ts',
    'components.json',
    'src/main.tsx',
    'src/styles/globals.css',
    'src-tauri/build.rs',
    'src-tauri/src/main.rs',
    'src-tauri/src/lib.rs',
    'src-tauri/capabilities/default.json',
  ];
  const missing = required.filter((file) => !existsSync(path.join(root, file)));
  assert.deepEqual(missing, []);
});
