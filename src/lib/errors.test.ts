import { expect, test } from 'vitest';

import type { BridgeError } from '@/bindings/bd';

import { describeError, internalError, isBridgeError, messageOf } from './errors';

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

test('bd errors reported on stdout are shown when stderr is empty', () => {
  const described = describeError({
    code: 'BD_EXIT_NONZERO',
    message: 'bd exited with status 1',
    detail: { bd_error: 'cannot resolve repo context: no .beads directory found', exit: 1 },
  });

  expect(described.message).toContain('cannot resolve repo context');
});

test('stderr wins over a stdout error when both are present', () => {
  const described = describeError({
    code: 'BD_EXIT_NONZERO',
    message: 'bd exited with status 1',
    detail: { stderr: 'from stderr', bd_error: 'from stdout' },
  });

  expect(described.message).toContain('from stderr');
  expect(described.message).not.toContain('from stdout');
});

test('unknown codes fall back to the bridge message instead of an empty string', () => {
  const described = describeError(error('INTERNAL', 'something specific broke'));

  expect(described.message).toBe('something specific broke');
});

test.each([
  { code: 'WRITE_CONFLICT', message: 'This issue changed elsewhere; refreshing the view.' },
  { code: 'BD_TIMEOUT', message: 'Saving timed out: bd did not respond within 20 seconds.' },
  { code: 'BD_LOCKED', message: 'The beads database is busy; try again in a moment.' },
  { code: 'BD_EXIT_NONZERO', message: 'bd rejected the change.' },
  {
    code: 'BD_NOT_FOUND',
    message: 'bd was not found. Set its path in Settings or install it with winget.',
  },
  { code: 'BD_NOT_EXECUTABLE', message: 'The configured bd path is not executable.' },
  {
    code: 'BD_VERSION_UNSUPPORTED',
    message: 'This bd version is older than 1.3.2; update bd and try again.',
  },
  { code: 'WS_NOT_BEADS', message: 'This directory is not a beads workspace.' },
  { code: 'WS_INACCESSIBLE', message: 'This workspace cannot be read.' },
  {
    code: 'JOURNAL_DISABLED',
    message: 'Real-time updates are off; the view was refreshed after saving.',
  },
  { code: 'INTERNAL', message: 'raw' },
] as const)('describes $code with actionable text', ({ code, message }) => {
  expect(describeError(error(code))).toEqual({ code, message });
});

test('isBridgeError accepts a complete string payload', () => {
  expect(isBridgeError(error('BD_TIMEOUT'))).toBe(true);
});

test.each([
  { name: 'null', value: null },
  { name: 'a non-object', value: 'BD_TIMEOUT' },
  { name: 'a missing code', value: { message: 'raw' } },
  { name: 'a missing message', value: { code: 'BD_TIMEOUT' } },
  { name: 'a non-string code', value: { code: 7, message: 'raw' } },
  { name: 'a non-string message', value: { code: 'BD_TIMEOUT', message: 7 } },
])('isBridgeError rejects $name', ({ value }) => {
  expect(isBridgeError(value)).toBe(false);
});

test('messageOf maps a bridge failure to its user-facing text', () => {
  expect(messageOf(error('BD_TIMEOUT'))).toBe(
    'Saving timed out: bd did not respond within 20 seconds.'
  );
});

test('messageOf reads an Error message', () => {
  expect(messageOf(new Error('boom'))).toBe('boom');
});

test('messageOf reads a plain object message', () => {
  expect(messageOf({ message: 'plain failure' })).toBe('plain failure');
});

test.each([
  { value: { message: 42 }, expected: '[object Object]' },
  { value: 42, expected: '42' },
])('messageOf stringifies an unsupported input', ({ value, expected }) => {
  expect(messageOf(value)).toBe(expected);
});

test('internalError wraps an unknown failure with its readable message', () => {
  expect(internalError({ message: 'wrap me' })).toEqual({
    code: 'INTERNAL',
    message: 'wrap me',
  });
});

test('bd exit failures ignore non-string diagnostic fields', () => {
  expect(
    describeError({
      code: 'BD_EXIT_NONZERO',
      message: 'raw',
      detail: { stderr: 1, bd_error: false },
    })
  ).toEqual({ code: 'BD_EXIT_NONZERO', message: 'bd rejected the change.' });
});
