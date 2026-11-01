import { expect, test } from 'vitest';

import type { BridgeError, WriteCommand } from '@/bindings/bd';

import { createWriteQueue, type WriteOutcome } from './queue';

function reopen(id: string): WriteCommand {
  return { Reopen: { id } };
}

function failure(code: BridgeError['code']): WriteOutcome {
  return { ok: false, error: { code, message: code } };
}

const success: WriteOutcome = { ok: true, createdId: null };

test('runs writes one at a time in submission order', async () => {
  let active = 0;
  let maxActive = 0;
  const started: string[] = [];
  const queue = createWriteQueue(async (command) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push('Reopen' in command ? command.Reopen.id : 'other');
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return success;
  });

  const first = queue.submit('first', () => reopen('first'));
  const second = queue.submit('second', () => reopen('second'));

  await Promise.all([first, second]);

  expect(started).toEqual(['first', 'second']);
  expect(maxActive).toBe(1);
});

test('deduplicates identical keys submitted before dispatch', async () => {
  let calls = 0;
  const queue = createWriteQueue(async () => {
    calls += 1;
    return success;
  });

  const results = Array.from({ length: 5 }, () => queue.submit('same', () => reopen('x')));

  expect(new Set(results).size).toBe(1);
  await Promise.all(results);
  expect(calls).toBe(1);
});

test('a key submitted again after dispatch is a new write', async () => {
  let calls = 0;
  const queue = createWriteQueue(async () => {
    calls += 1;
    return success;
  });

  const first = queue.submit('same', () => reopen('x'));
  await first;
  const second = queue.submit('same', () => reopen('x'));
  await second;

  expect(calls).toBe(2);
});

test('maps a write conflict without retrying', async () => {
  let calls = 0;
  const queue = createWriteQueue(async () => {
    calls += 1;
    return failure('WRITE_CONFLICT');
  });

  const result = await queue.submit('conflict', () => reopen('x'));

  expect(result.status).toBe('conflict');
  expect(calls).toBe(1);
});

test('a timeout fails once and is never retried', async () => {
  let calls = 0;
  const queue = createWriteQueue(async () => {
    calls += 1;
    return failure('BD_TIMEOUT');
  });

  const result = await queue.submit('timeout', () => reopen('x'));

  expect(result).toEqual({ status: 'failed', error: { code: 'BD_TIMEOUT', message: 'BD_TIMEOUT' } });
  expect(calls).toBe(1);
});

test('passes a created id back to the caller', async () => {
  const queue = createWriteQueue(async () => ({ ok: true, createdId: 'bza-99' }));

  const result = await queue.submit('create', () => reopen('x'));

  expect(result).toEqual({ status: 'ok', createdId: 'bza-99' });
});

test('a throwing executor becomes a visible internal failure', async () => {
  const queue = createWriteQueue(async () => {
    throw new Error('ipc exploded');
  });

  const result = await queue.submit('explode', () => reopen('x'));

  expect(result.status).toBe('failed');
  if (result.status === 'failed') {
    expect(result.error.code).toBe('INTERNAL');
    expect(result.error.message).toContain('ipc exploded');
  }
});

test('the queue keeps draining after a failure', async () => {
  const calls: string[] = [];
  const queue = createWriteQueue(async (command) => {
    calls.push('Reopen' in command ? command.Reopen.id : 'other');
    return command && 'Reopen' in command && command.Reopen.id === 'bad'
      ? failure('BD_EXIT_NONZERO')
      : success;
  });

  const bad = queue.submit('bad', () => reopen('bad'));
  const good = queue.submit('good', () => reopen('good'));
  const [badResult, goodResult] = await Promise.all([bad, good]);

  expect(badResult.status).toBe('failed');
  expect(goodResult.status).toBe('ok');
  expect(calls).toEqual(['bad', 'good']);
});