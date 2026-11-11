import { afterEach, expect, test, vi } from 'vitest';

import type { JournalRecord } from '@/bindings/bd';
import { makeIssue as issue, TEST_TS as TS } from '@/test/fixtures';

import { createEchoWaiter } from './echo';
import { createTicketStore, type TicketStore } from './store';

function record(seq: number, issueId: string): JournalRecord {
  return { seq, ts: TS, op: 'update', issue_id: issueId, issue: issue(issueId) };
}

function storeWith(records: JournalRecord[] = [], since = 0): TicketStore {
  const store = createTicketStore();
  store.applySnapshot([], since);
  store.applyRecords(records);
  return store;
}

afterEach(() => {
  vi.useRealTimers();
});

test('resolves echoed when the issue already advanced past afterSeq', async () => {
  vi.useFakeTimers();
  const store = storeWith([record(5, 'a')], 4);
  const wait = createEchoWaiter(store, () => false)('a', 4, 3000);

  await expect(wait).resolves.toBe('echoed');
});

test('resolves echoed when the record arrives', async () => {
  vi.useFakeTimers();
  const store = storeWith([], 4);
  const wait = createEchoWaiter(store, () => false)('a', 4, 3000);

  store.applyRecords([record(5, 'a')]);

  await expect(wait).resolves.toBe('echoed');
});

test('ignores records for other issues', async () => {
  vi.useFakeTimers();
  const store = storeWith([], 4);
  const wait = createEchoWaiter(store, () => false)('a', 4, 3000);
  let settled = false;
  void wait.then(() => {
    settled = true;
  });

  store.applyRecords([record(5, 'b')]);

  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(3000);
  await expect(wait).resolves.toBe('timeout');
});

test('returns disabled immediately when the journal is off', async () => {
  vi.useFakeTimers();
  const store = storeWith();
  const wait = createEchoWaiter(store, () => true)('a', 0, 3000);

  await expect(wait).resolves.toBe('disabled');
});

test('times out after the budget', async () => {
  vi.useFakeTimers();
  const store = storeWith();
  const wait = createEchoWaiter(store, () => false)('a', 0, 3000);
  let settled = false;
  void wait.then(() => {
    settled = true;
  });

  await vi.advanceTimersByTimeAsync(2999);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  await expect(wait).resolves.toBe('timeout');
});

test('returns disabled if the journal turns off while waiting', async () => {
  vi.useFakeTimers();
  let disabled = false;
  const store = storeWith();
  const wait = createEchoWaiter(store, () => disabled)('a', 0, 3000);

  disabled = true;
  store.applyRecords([record(1, 'b')]);

  await expect(wait).resolves.toBe('disabled');
});

test('a timeout unsubscribes from later changes', async () => {
  vi.useFakeTimers();
  const store = storeWith();
  const wait = createEchoWaiter(store, () => false)('a', 0, 10);

  await vi.advanceTimersByTimeAsync(10);
  await expect(wait).resolves.toBe('timeout');

  expect(() => store.applyRecords([record(1, 'a')])).not.toThrow();
});