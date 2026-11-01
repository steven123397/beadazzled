import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findSecretConfigKeys } from '../../scripts/lib/beads-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('comments and non-secret keys are ignored', () => {
  const text = [
    '# - linear.api_key  → use LINEAR_API_KEY instead',
    '# - github.token    → use GITHUB_TOKEN instead',
    'sync:',
    '    remote: "git+ssh://git@github.com/steven123397/beadazzled.git"',
    'github:',
    '    org: steven123397',
    '    repo: beadazzled',
    'events-journal: true',
  ].join('\n');

  assert.deepEqual(findSecretConfigKeys(text), []);
});

test('nested secret keys are detected', () => {
  assert.deepEqual(findSecretConfigKeys('github:\n    token: x\n'), ['github.token']);
  assert.deepEqual(findSecretConfigKeys('linear:\n    api_key: x\n'), ['linear.api_key']);
  assert.deepEqual(findSecretConfigKeys('jira:\n    api_token: x\n'), ['jira.api_token']);
  assert.deepEqual(findSecretConfigKeys('service:\n    password: x\n'), ['service.password']);
});

test('flat dotted secret keys are detected', () => {
  assert.deepEqual(findSecretConfigKeys('github.token: x\n'), ['github.token']);
  assert.deepEqual(findSecretConfigKeys('linear.api_key: x\n'), ['linear.api_key']);
});

test('inline comments and indentation do not hide a secret', () => {
  assert.deepEqual(findSecretConfigKeys('github: # integration\n  token: x # leaked\n'), [
    'github.token',
  ]);
});

test('non-secret sibling keys do not trigger', () => {
  const text = ['github:', '    org: acme', '    repo: app', 'linear:', '    team_id: abc'].join(
    '\n'
  );

  assert.deepEqual(findSecretConfigKeys(text), []);
});

test('the tracked .beads/config.yaml is secret-free', () => {
  const text = readFileSync(path.join(root, '.beads', 'config.yaml'), 'utf8');

  assert.deepEqual(findSecretConfigKeys(text), []);
});
