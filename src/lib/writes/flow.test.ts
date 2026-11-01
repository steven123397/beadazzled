import { afterEach, expect, test, vi } from 'vitest';

import type { BridgeError, WriteCommand } from '@/bindings/bd';

import { createTicketStore } from '../sync/store';
import { createWriteFlow, submitWrite, type WriteFlow } from './flow';

function reopen(id: string): WriteCommand {
  return { Reopen: { id } };
}

function flow(
  outcome: 'echoed' | 'timeout' | 'disabled' | 'conflict' | 'failed',
  overrides: Partial<WriteFlow> = {}
): WriteFlow & { refreshes: number; echoes: Array<[string, number, number | undefined]> } {
  const state = {
    refreshes: 0,
    echoes: [] as Array<[string, number, number | undefined]>,
  };
  const base: WriteFlow = {
    queue: {
      submit: async (_key, build) => {
        const command = build();
        const issueId = 'Reopen' in command ? command.Reopen.id : 'created';
        if (outcome === 'conflict') {
          const error: BridgeError = { code: 'WRITE_CONFLICT', message: 'changed' };
          return { status: 'conflict', error, createdId: issueId };
        }
        if (outcome === 'failed') {
          const error: BridgeError = { code: 'BD_EXIT_NONZERO', message: 'nope' };
          return { status: 'failed', error };
        }
        return { status: 'ok', createdId: issueId };
      },
      pendingCount: () => 0,
    },
    currentSeq: () => 41,
    waitForEcho: async (issueId, afterSeq, timeoutMs) => {
      state.echoes.push([issueId, afterSeq, timeoutMs]);
      return outcome === 'echoed' || outcome === 'timeout' || outcome === 'disabled'
        ? outcome
        : 'echoed';
    },
    refresh: () => {
      state.refreshes += 1;
    },
  };
  return {
    ...base,
    ...overrides,
    get refreshes() {
      return state.refreshes;
    },
    get echoes() {
      return state.echoes;
    },
  };
}

test('an echoed write does not refresh', async () => {
  const deps = flow('echoed');

  const result = await submitWrite(deps, {
    key: 'k',
    issueId: 'bza-1',
    build: () => reopen('bza-1'),
  });

  expect(result.status).toBe('ok');
  expect(deps.refreshes).toBe(0);
  expect(deps.echoes).toEqual([['bza-1', 41, 3000]]);
});

test('an echo timeout triggers one baseline', async () => {
  const deps = flow('timeout');

  await submitWrite(deps, { key: 'k', issueId: 'bza-1', build: () => reopen('bza-1') });

  expect(deps.refreshes).toBe(1);
});

test('a disabled journal refreshes immediately after a successful write', async () => {
  const deps = flow('disabled');

  const result = await submitWrite(deps, {
    key: 'k',
    issueId: 'bza-1',
    build: () => reopen('bza-1'),
  });

  expect(result.status).toBe('ok');
  expect(deps.refreshes).toBe(1);
});

test('a conflict refreshes and never waits for an echo', async () => {
  const deps = flow('conflict');

  const result = await submitWrite(deps, {
    key: 'k',
    issueId: 'bza-1',
    build: () => reopen('bza-1'),
  });

  expect(result.status).toBe('conflict');
  expect(deps.refreshes).toBe(1);
  expect(deps.echoes).toEqual([]);
});

test('a failed write does not refresh or wait for an echo', async () => {
  const deps = flow('failed');

  const result = await submitWrite(deps, {
    key: 'k',
    issueId: 'bza-1',
    build: () => reopen('bza-1'),
  });

  expect(result.status).toBe('failed');
  expect(deps.refreshes).toBe(0);
  expect(deps.echoes).toEqual([]);
});

test('a write without an issue id does not wait for an echo', async () => {
  const deps = flow('echoed', {
    queue: {
      submit: async () => ({ status: 'ok' }),
      pendingCount: () => 0,
    },
  });

  const result = await submitWrite(deps, { key: 'k', issueId: null, build: () => reopen('x') });

  expect(result).toEqual({ status: 'ok' });
  expect(deps.echoes).toEqual([]);
  expect(deps.refreshes).toBe(0);
});

test('a create waits for the echo of the id bd returned', async () => {
  const deps = flow('echoed', {
    queue: {
      submit: async () => ({ status: 'ok', createdId: 'bza-new' }),
      pendingCount: () => 0,
    },
  });

  await submitWrite(deps, { key: 'k', issueId: null, build: () => reopen('x') });

  expect(deps.echoes).toEqual([['bza-new', 41, 3000]]);
});
afterEach(() => {
  vi.useRealTimers();
});

test('createWriteFlow wires afterSeq, echo and refresh from the store', async () => {
  vi.useFakeTimers();
  const store = createTicketStore();
  store.applySnapshot([], 4);
  const sent: WriteCommand[] = [];
  let refreshes = 0;
  const flow = createWriteFlow({
    store,
    execute: async (command) => {
      sent.push(command);
      return { ok: true, createdId: null };
    },
    refresh: () => {
      refreshes += 1;
    },
    isJournalDisabled: () => false,
  });

  const pending = submitWrite(flow, {
    key: 'k',
    issueId: 'bza-1',
    build: () => reopen('bza-1'),
  });
  await vi.advanceTimersByTimeAsync(0);
  store.applyRecords([
    { seq: 5, ts: '2026-11-01T00:00:05Z', op: 'update', issue_id: 'bza-1', issue: null },
  ]);
  const result = await pending;

  expect(result).toEqual({ status: 'ok' });
  expect(sent).toHaveLength(1);
  expect(refreshes).toBe(0);
  expect(store.getState().lastSeq).toBe(5);
});
