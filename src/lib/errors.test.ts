import { expect, test } from 'vitest';

import type { BridgeError } from '@/bindings/bd';

import { describeError } from './errors';

function error(code: BridgeError['code'], message = 'raw'): BridgeError {
  return { code, message };
}

test('conflict explains that the issue changed elsewhere', () => {
  const described = describeError(error('WRITE_CONFLICT'));

  expect(described.code).toBe('WRITE_CONFLICT');
  expect(described.message).toMatch(/changed elsewhere/i);
});

test('timeout mentions the 20 second budget', () => {
  expect(describeError(error('BD_TIMEOUT')).message).toMatch(/20 seconds/);
});

test('a locked database tells the user to retry', () => {
  expect(describeError(error('BD_LOCKED')).message).toMatch(/busy/i);
});

test('bd exit failures include a truncated stderr summary', () => {
  const stderr = 'x'.repeat(400);
  const described = describeError({
    code: 'BD_EXIT_NONZERO',
    message: 'bd exited with status 1',
    detail: { stderr, exit: 1 },
  });

  expect(described.message).toContain('x'.repeat(300));
  expect(described.message).not.toContain('x'.repeat(301));
});

test('unknown codes fall back to the bridge message instead of an empty string', () => {
  const described = describeError(error('INTERNAL', 'something specific broke'));

  expect(described.message).toBe('something specific broke');
});