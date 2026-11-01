import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const security = config.app?.security ?? {};

// Tauri accepts either a single policy string or an object of directive -> sources.
function toObject(policy, label) {
  assert.ok(policy, `${label} is missing`);
  if (typeof policy === 'string') {
    return Object.fromEntries(
      policy
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [directive, ...sources] = part.split(/\s+/);
          return [directive, sources];
        })
    );
  }

  return Object.fromEntries(
    Object.entries(policy).map(([directive, sources]) => [
      directive,
      Array.isArray(sources) ? sources : sources.split(/\s+/).filter(Boolean),
    ])
  );
}

const production = toObject(security.csp, 'app.security.csp');
const development = toObject(security.devCsp, 'app.security.devCsp');

test('production CSP is enabled and self-hosted by default', () => {
  assert.deepEqual(production['default-src'], ["'self'"]);
});

test('production CSP allows only the Tauri IPC channel beyond self', () => {
  const connect = production['connect-src'] ?? [];

  assert.ok(connect.includes("'self'"), "connect-src must include 'self'");
  assert.ok(connect.includes('ipc:'), 'connect-src must include ipc:');
  assert.ok(
    connect.includes('http://ipc.localhost'),
    'connect-src must include http://ipc.localhost'
  );

  for (const source of connect) {
    if (source === "'self'" || source === 'ipc:' || source === 'http://ipc.localhost') {
      continue;
    }
    assert.fail(`connect-src allows an unexpected source: ${source}`);
  }
});

test('production CSP never allows inline or evaluated scripts', () => {
  const script = production['script-src'] ?? [];

  assert.deepEqual(script, ["'self'"], 'script-src must be exactly self');
  assert.ok(!script.includes("'unsafe-inline'"), 'script-src must not allow unsafe-inline');
  assert.ok(!script.includes("'unsafe-eval'"), 'script-src must not allow unsafe-eval');
});

test('production CSP locks down plugins, frames and navigation', () => {
  assert.deepEqual(production['object-src'], ["'none'"]);
  assert.deepEqual(production['frame-src'], ["'none'"]);
  assert.deepEqual(production['frame-ancestors'], ["'none'"]);
  assert.deepEqual(production['base-uri'], ["'none'"]);
  assert.deepEqual(production['form-action'], ["'none'"]);
});

test('production CSP keeps images on self and data URLs', () => {
  const img = production['img-src'] ?? [];

  assert.deepEqual(img, ["'self'", 'data:']);
  assert.ok(!img.includes('http:'), 'remote images must not be allowed');
  assert.ok(!img.includes('https:'), 'remote images must not be allowed');
});

test('production CSP allows inline styles only', () => {
  const style = production['style-src'] ?? [];

  assert.deepEqual(style, ["'self'", "'unsafe-inline'"]);
});

test('no production directive uses wildcards, remote origins or eval', () => {
  for (const [directive, sources] of Object.entries(production)) {
    for (const source of sources) {
      assert.notEqual(source, '*', `${directive} must not allow *`);
      assert.ok(!source.includes('unsafe-eval'), `${directive} must not allow unsafe-eval`);
      if (source === 'http://ipc.localhost' || source === 'ipc:') {
        continue;
      }
      assert.ok(
        !/^https?:\/\//.test(source),
        `${directive} must not load remote content: ${source}`
      );
    }
  }
});

test('development CSP stays close to production but supports the Vite dev server', () => {
  const script = development['script-src'] ?? [];
  const connect = development['connect-src'] ?? [];
  const defaultSrc = development['default-src'] ?? [];

  // The React refresh preamble is an inline module script served by Vite.
  assert.ok(script.includes("'unsafe-inline'"), 'dev script-src must allow the Vite preamble');
  assert.ok(script.includes('http://localhost:1420'), 'dev script-src must allow the Vite server');
  // Vite HMR talks over a WebSocket.
  assert.ok(connect.includes('ws://localhost:1420'), 'dev connect-src must allow Vite HMR');
  assert.ok(
    connect.includes('http://localhost:1420'),
    'dev connect-src must allow the Vite server'
  );
  assert.ok(defaultSrc.includes("'self'"), "dev default-src must keep 'self'");

  assert.ok(!script.includes("'unsafe-eval'"), 'dev CSP must not allow eval');
  for (const [directive, sources] of Object.entries(development)) {
    for (const source of sources) {
      assert.notEqual(source, '*', `${directive} must not allow *`);
      assert.ok(!source.includes('unsafe-eval'), `${directive} must not allow unsafe-eval`);
    }
  }
});

test('development CSP keeps the same lockdown directives as production', () => {
  for (const directive of [
    'object-src',
    'frame-src',
    'frame-ancestors',
    'base-uri',
    'form-action',
  ]) {
    assert.deepEqual(development[directive], production[directive], `dev ${directive} drifted`);
  }
});

test('the CSP decision is recorded in an ADR', () => {
  const adrDir = path.join(root, 'docs/adr');
  assert.ok(existsSync(adrDir), 'docs/adr is missing');

  const match = readdirSync(adrDir).find((file) => /^0009-.*\.md$/.test(file));
  assert.ok(match, 'ADR-0009 covering the CSP baseline is missing');

  const adr = readFileSync(path.join(adrDir, match), 'utf8');
  assert.match(adr, /devCsp/);
  assert.match(adr, /ipc:\/\/|http:\/\/ipc\.localhost|ipc:/);
});
