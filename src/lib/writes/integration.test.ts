import { afterEach, expect, test, vi } from 'vitest';

import type { BridgeError, CreateSpec, Issue, JournalRecord, WriteCommand } from '@/bindings/bd';

import { createIssue, updateIssue } from './commands';
import { describeError } from '@/lib/errors';
import { submitWrite, type WriteFlow } from './flow';
import { createTicketStore } from '../sync/store';
import { createEchoWaiter } from '../sync/echo';
import { createWriteQueue, type WriteOutcome } from './queue';

const TS = '2026-11-01T00:00:00Z';

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: TS,
    updated_at: TS,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function record(seq: number, issueId: string): JournalRecord {
  return {
    seq,
    ts: TS,
    op: 'update',
    issue_id: issueId,
    issue: issue(issueId, { status: 'in_progress' }),
  };
}

function commandOf(result: ReturnType<typeof updateIssue>) {
  if (!result.ok) {
    throw new Error(`expected a command, got ${result.error.code}`);
  }
  return result.command;
}

type Harness = {
  flow: WriteFlow;
  store: ReturnType<typeof createTicketStore>;
  calls: WriteCommand[];
  refreshes: number[];
  echoWaits: Array<[string, number, number | undefined]>;
  setJournalDisabled: (disabled: boolean) => void;
};

function harness(outcome: (command: unknown) => WriteOutcome): Harness {
  const calls: WriteCommand[] = [];
  const refreshes: number[] = [];
  const echoWaits: Harness['echoWaits'] = [];
  let journalDisabled = false;

  const queue = createWriteQueue(async (_workspace, command) => {
    calls.push(command);
    return outcome(command);
  });
  const store = createTicketStore();
  store.applySnapshot([issue('bza-1')], 0);
  const echo = createEchoWaiter(store, () => journalDisabled);

  const flow: WriteFlow = {
    queue,
    workspace: () => 'C:/ws',
    currentSeq: () => store.getState().lastSeq,
    waitForEcho: (issueId, afterSeq, timeoutMs) => {
      echoWaits.push([issueId, afterSeq, timeoutMs]);
      return echo(issueId, afterSeq, timeoutMs);
    },
    refresh: () => {
      refreshes.push(store.getState().lastSeq);
    },
  };

  return {
    flow,
    store,
    calls,
    refreshes,
    echoWaits,
    setJournalDisabled: (disabled) => {
      journalDisabled = disabled;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test('a 64 KiB description travels in the stdin-bound field, not in any argv field', async () => {
  const description = `中文 "quoted" & |\n${'x'.repeat(64 * 1024)}`;
  const command = commandOf(createIssue({ title: 'Long body', description }));
  vi.useFakeTimers();
  const h = harness(() => ({ ok: true, createdId: 'bza-new' }));

  const pending = submitWrite(h.flow, { key: 'long', issueId: null, build: () => command });
  await vi.advanceTimersByTimeAsync(3_000);
  await pending;

  expect(h.calls).toHaveLength(1);
  const sent = h.calls[0] as { Create: CreateSpec };
  expect(sent.Create.description).toBe(description);
  expect(new TextEncoder().encode(sent.Create.description).length).toBeGreaterThanOrEqual(
    64 * 1024
  );
  // Acceptance would travel through argv, so it is capped before dispatch.
  const rejected = createIssue({ title: 'Long acceptance', acceptance: 'x'.repeat(16 * 1024 + 1) });
  expect(rejected.ok).toBe(false);
});

test('one multi-field edit becomes exactly one update command', async () => {
  vi.useFakeTimers();
  const h = harness(() => ({ ok: true, createdId: null }));
  const command = commandOf(
    updateIssue('bza-1', {
      status: 'in_progress',
      priority: 1,
      title: 'Renamed',
      addLabels: ['backend'],
      removeLabels: ['frontend'],
      ifStatus: 'open',
    })
  );

  const pending = submitWrite(h.flow, {
    key: 'merge',
    issueId: 'bza-1',
    build: () => command,
  });
  await vi.advanceTimersByTimeAsync(3_000);
  await pending;

  expect(h.calls).toHaveLength(1);
  expect(h.calls[0]).toMatchObject({
    Update: {
      id: 'bza-1',
      status: 'in_progress',
      priority: 1,
      title: 'Renamed',
      add_labels: ['backend'],
      remove_labels: ['frontend'],
      if_status: 'open',
    },
  });
});

test('an echo timeout refreshes once and never rewrites', async () => {
  vi.useFakeTimers();
  const h = harness(() => ({ ok: true, createdId: null }));
  const pending = submitWrite(h.flow, {
    key: 'timeout',
    issueId: 'bza-1',
    build: () => commandOf(updateIssue('bza-1', { status: 'in_progress' })),
  });

  await vi.advanceTimersByTimeAsync(3_000);
  const result = await pending;

  expect(result.status).toBe('ok');
  expect(h.refreshes).toHaveLength(1);
  expect(h.calls).toHaveLength(1);
  expect(h.echoWaits).toEqual([['bza-1', 0, 3_000]]);
});

test('the journal echo updates the store without a refresh', async () => {
  vi.useFakeTimers();
  const h = harness(() => ({ ok: true, createdId: null }));
  const pending = submitWrite(h.flow, {
    key: 'echo',
    issueId: 'bza-1',
    build: () => commandOf(updateIssue('bza-1', { status: 'in_progress' })),
  });

  await vi.advanceTimersByTimeAsync(0);
  h.store.applyRecords([record(1, 'bza-1')]);
  const result = await pending;

  expect(result.status).toBe('ok');
  expect(h.refreshes).toEqual([]);
  expect(h.store.getState().issues['bza-1'].status).toBe('in_progress');
});

test('exit 13 becomes a conflict: one refresh, no retry and no echo wait', async () => {
  const error: BridgeError = { code: 'WRITE_CONFLICT', message: 'precondition failed' };
  const h = harness(() => ({ ok: false, error }));

  const result = await submitWrite(h.flow, {
    key: 'conflict',
    issueId: 'bza-1',
    build: () => commandOf(updateIssue('bza-1', { status: 'in_progress', ifStatus: 'open' })),
  });

  expect(result.status).toBe('conflict');
  expect(h.calls).toHaveLength(1);
  expect(h.refreshes).toHaveLength(1);
  expect(h.echoWaits).toEqual([]);
  expect(describeError(error).message).toMatch(/changed elsewhere/i);
});

test('a bd timeout fails once, does not refresh and is visible', async () => {
  const error: BridgeError = { code: 'BD_TIMEOUT', message: 'timed out' };
  const h = harness(() => ({ ok: false, error }));

  const result = await submitWrite(h.flow, {
    key: 'bd-timeout',
    issueId: 'bza-1',
    build: () => commandOf(updateIssue('bza-1', { priority: 0 })),
  });

  expect(result.status).toBe('failed');
  expect(h.calls).toHaveLength(1);
  expect(h.refreshes).toEqual([]);
  expect(describeError(error).message).toMatch(/20 seconds/);
});

test('a disabled journal refreshes immediately after a successful write', async () => {
  vi.useFakeTimers();
  const h = harness(() => ({ ok: true, createdId: null }));
  h.setJournalDisabled(true);

  const pending = submitWrite(h.flow, {
    key: 'disabled',
    issueId: 'bza-1',
    build: () => commandOf(updateIssue('bza-1', { priority: 3 })),
  });

  const result = await pending;

  expect(result.status).toBe('ok');
  expect(h.calls).toHaveLength(1);
  expect(h.refreshes).toHaveLength(1);
});

test('every failure code has user-visible text', async () => {
  const codes: Array<BridgeError['code']> = [
    'WRITE_CONFLICT',
    'BD_TIMEOUT',
    'BD_LOCKED',
    'BD_EXIT_NONZERO',
    'BD_NOT_FOUND',
    'BD_VERSION_UNSUPPORTED',
    'WS_NOT_BEADS',
    'BD_PARSE_FAILED',
  ];

  for (const code of codes) {
    const error: BridgeError = { code, message: `raw ${code}` };
    const h = harness(() => ({ ok: false, error }));

    const result = await submitWrite(h.flow, {
      key: code,
      issueId: 'bza-1',
      build: () => commandOf(updateIssue('bza-1', { priority: 1 })),
    });

    expect(result.status).toBe(code === 'WRITE_CONFLICT' ? 'conflict' : 'failed');
    expect(h.calls).toHaveLength(1);
    expect(describeError(error).message.trim()).not.toBe('');
  }
});