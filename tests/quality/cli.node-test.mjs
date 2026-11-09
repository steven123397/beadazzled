import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseOptions } from '../../scripts/lib/cli.mjs';

test('parseOptions parses flags and values with spaces and equal signs', () => {
  const spec = {
    flags: ['--verbose', '--dry-run'],
    values: ['--target', '--count'],
    defaults: { target: 'default', count: '10', verbose: false },
  };

  const parsed = parseOptions(['--verbose', '--target', 'production', '--count=42'], spec);
  assert.deepEqual(parsed, {
    verbose: true,
    target: 'production',
    count: '42',
  });
});

test('parseOptions rejects values when missing argument or empty without allowEmpty', () => {
  const spec = {
    values: ['--target'],
    allowEmpty: [],
  };

  assert.throws(() => parseOptions(['--target'], spec), /--target needs a value/);
  assert.throws(() => parseOptions(['--target', ''], spec), /--target needs a value/);
  assert.throws(() => parseOptions(['--target='], spec), /--target needs a value/);
});

test('parseOptions accepts empty strings for options configured in allowEmpty', () => {
  const spec = {
    values: ['--notes', '--message'],
    allowEmpty: ['--notes', 'message'],
    defaults: { notes: 'initial', message: 'initial' },
  };

  const inline = parseOptions(['--notes='], spec);
  assert.equal(inline.notes, '');

  const separate = parseOptions(['--notes', ''], spec);
  assert.equal(separate.notes, '');

  const withoutDashesInSpec = parseOptions(['--message='], spec);
  assert.equal(withoutDashesInSpec.message, '');

  assert.throws(() => parseOptions(['--notes'], spec), /--notes needs a value/);
});

test('parseOptions reports unknown options', () => {
  assert.throws(() => parseOptions(['--mystery']), /unknown option: --mystery/);
});
