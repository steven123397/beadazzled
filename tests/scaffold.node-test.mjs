import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

// Every command listed in spec/capability-map.md must be declared in package.json.
const CAPABILITY_MAP_SCRIPTS = [
  'dev',
  'dev:web',
  'typecheck',
  'lint',
  'test:unit',
  'test:rust',
  'gen:bindings',
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

test('package.json declares version 0.1.0', () => {
  assert.equal(readJson('package.json').version, '0.1.0');
});

test('package.json declares every capability-map command', () => {
  const scripts = readJson('package.json').scripts ?? {};
  const missing = CAPABILITY_MAP_SCRIPTS.filter((name) => !scripts[name]);
  assert.deepEqual(missing, []);
});

test('tauri.conf.json carries the product identity', () => {
  const config = readJson('src-tauri/tauri.conf.json');
  assert.equal(config.productName, 'beadazzled');
  assert.equal(config.version, '0.1.0');
  assert.equal(config.identifier, 'com.steven123397.beadazzled');
});

test('Cargo.toml version matches package.json', () => {
  const cargoToml = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const version = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml)?.[1];
  assert.equal(version, readJson('package.json').version);
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
