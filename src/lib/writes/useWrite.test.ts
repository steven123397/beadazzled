import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import type { BdStatus, WriteCommand } from '@/bindings/bd';

import type { WriteFlow } from './flow';
import type { WriteResult } from './queue';
import { useWrite } from './useWrite';

const READY: BdStatus = { kind: 'ready', path: 'C:/tools/bd.exe', version: '1.3.2' };
const NOT_FOUND: BdStatus = { kind: 'not-found', searched: ['C:/tools/bd.exe'] };
const COMMAND: WriteCommand = { Reopen: { id: 'bza-1' } };

function fakeFlow(outcome: WriteResult): {
  flow: WriteFlow;
  calls: () => number;
  refreshes: () => number;
} {
  let calls = 0;
  let refreshes = 0;
  const flow: WriteFlow = {
    queue: {
      submit: async (_key, _workspace, _build, afterSeq) => {
        calls += 1;
        return outcome.status === 'ok' ? { ...outcome, afterSeq: afterSeq?.() ?? 0 } : outcome;
      },
      pendingCount: () => 0,
    },
    workspace: () => 'C:/ws',
    currentSeq: () => 0,
    waitForEcho: async () => 'echoed',
    refresh: () => {
      refreshes += 1;
    },
  };
  return { flow, calls: () => calls, refreshes: () => refreshes };
}

test('writes are enabled when bd is ready', () => {
  const { flow } = fakeFlow({ status: 'ok' });

  const { result } = renderHook(() => useWrite(flow, READY));

  expect(result.current.canWrite).toBe(true);
  expect(result.current.disabledReason).toBeNull();
});

test('a successful write clears pending and leaves no error', async () => {
  const { flow } = fakeFlow({ status: 'ok' });
  const { result } = renderHook(() => useWrite(flow, READY));

  await act(async () => {
    const outcome = await result.current.submit({
      key: 'k',
      issueId: 'bza-1',
      build: () => COMMAND,
    });
    expect(outcome.status).toBe('ok');
  });

  expect(result.current.error).toBeNull();
  expect(result.current.result).toMatchObject({ status: 'ok', echo: 'echoed' });
  expect(result.current.isPending('bza-1')).toBe(false);
});

test('the issue stays pending until the write and its echo settle', async () => {
  let settle!: (result: WriteResult) => void;
  const gate = new Promise<WriteResult>((resolve) => {
    settle = resolve;
  });
  const flow: WriteFlow = {
    queue: { submit: () => gate, pendingCount: () => 0 },
    workspace: () => 'C:/ws',
    currentSeq: () => 0,
    waitForEcho: async () => 'echoed',
    refresh: () => {},
  };
  const { result } = renderHook(() => useWrite(flow, READY));

  let submission = Promise.resolve({} as WriteResult);
  act(() => {
    submission = result.current.submit({ key: 'k', issueId: 'bza-1', build: () => COMMAND });
  });
  expect(result.current.isPending('bza-1')).toBe(true);

  await act(async () => {
    settle({ status: 'ok' });
    await submission;
  });
  expect(result.current.isPending('bza-1')).toBe(false);
});

test('overlapping writes keep the issue pending until the last one settles', async () => {
  let settleFirst!: (result: WriteResult) => void;
  let settleSecond!: (result: WriteResult) => void;
  const gates = [
    new Promise<WriteResult>((resolve) => {
      settleFirst = resolve;
    }),
    new Promise<WriteResult>((resolve) => {
      settleSecond = resolve;
    }),
  ];
  let call = 0;
  const flow: WriteFlow = {
    queue: { submit: () => gates[call++], pendingCount: () => 0 },
    workspace: () => 'C:/ws',
    currentSeq: () => 0,
    waitForEcho: async () => 'echoed',
    refresh: () => {},
  };
  const { result } = renderHook(() => useWrite(flow, READY));

  let first = Promise.resolve({} as WriteResult);
  let second = Promise.resolve({} as WriteResult);
  act(() => {
    first = result.current.submit({ key: 'a', issueId: 'bza-1', build: () => COMMAND });
    second = result.current.submit({ key: 'b', issueId: 'bza-1', build: () => COMMAND });
  });
  expect(result.current.isPending('bza-1')).toBe(true);
  expect(result.current.pending).toEqual(['bza-1']);

  await act(async () => {
    settleFirst({ status: 'ok' });
    await first;
  });
  expect(result.current.isPending('bza-1')).toBe(true);

  await act(async () => {
    settleSecond({ status: 'ok' });
    await second;
  });
  expect(result.current.isPending('bza-1')).toBe(false);
  expect(result.current.pending).toEqual([]);
});

test('a failure is visible and keeps the result', async () => {
  const { flow } = fakeFlow({
    status: 'failed',
    error: { code: 'BD_TIMEOUT', message: 'timed out' },
  });
  const { result } = renderHook(() => useWrite(flow, READY));

  await act(async () => {
    await result.current.submit({ key: 'k', issueId: 'bza-1', build: () => COMMAND });
  });

  expect(result.current.result?.status).toBe('failed');
  expect(result.current.error).toMatch(/20 seconds/);
});

test('a conflict shows the conflict text and refreshes once', async () => {
  const { flow, refreshes } = fakeFlow({
    status: 'conflict',
    error: { code: 'WRITE_CONFLICT', message: 'precondition failed' },
  });
  const { result } = renderHook(() => useWrite(flow, READY));

  await act(async () => {
    await result.current.submit({ key: 'k', issueId: 'bza-1', build: () => COMMAND });
  });

  expect(result.current.error).toMatch(/changed elsewhere/i);
  expect(refreshes()).toBe(1);
});

test('writes are refused without calling bd when it is not available', async () => {
  const { flow, calls } = fakeFlow({ status: 'ok' });
  const { result } = renderHook(() => useWrite(flow, NOT_FOUND));

  expect(result.current.canWrite).toBe(false);
  expect(result.current.disabledReason).toMatch(/not found/i);

  await act(async () => {
    const outcome = await result.current.submit({
      key: 'k',
      issueId: 'bza-1',
      build: () => COMMAND,
    });
    expect(outcome.status).toBe('failed');
  });

  expect(calls()).toBe(0);
  expect(result.current.error).toMatch(/not found/i);
});

test('an unsupported bd uses the same described error for disabled state and submit', async () => {
  const { flow, calls } = fakeFlow({ status: 'ok' });
  const { result } = renderHook(() =>
    useWrite(flow, { kind: 'unsupported', path: 'C:/bd.exe', found: '1.2.9', min: '1.3.2' })
  );

  expect(result.current.canWrite).toBe(false);
  expect(result.current.disabledReason).toBe(
    'This bd version is older than 1.3.2; update bd and try again.'
  );

  await act(async () => {
    const outcome = await result.current.submit({
      key: 'k',
      issueId: 'bza-1',
      build: () => COMMAND,
    });
    expect(outcome.status).toBe('failed');
  });

  expect(calls()).toBe(0);
  expect(result.current.error).toBe(result.current.disabledReason);
});

test('clearError dismisses the message', async () => {
  const { flow } = fakeFlow({
    status: 'failed',
    error: { code: 'BD_LOCKED', message: 'locked' },
  });
  const { result } = renderHook(() => useWrite(flow, READY));
  await act(async () => {
    await result.current.submit({ key: 'k', issueId: 'bza-1', build: () => COMMAND });
  });

  act(() => {
    result.current.clearError();
  });

  expect(result.current.error).toBeNull();
});
