import { expect, test } from 'vitest';

import type { Issue, JournalRecord } from '@/bindings/bd';

import { applyRecords } from './reducer';
import { createTicketStore } from './store';

const TS = '2026-11-01T00:00:00Z';

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: `Description ${id}`,
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

function record(
  seq: number,
  issueId: string,
  overrides: Partial<JournalRecord> = {}
): JournalRecord {
  return {
    seq,
    ts: TS,
    op: 'update',
    issue_id: issueId,
    issue: issue(issueId),
    ...overrides,
  };
}

test('an issue id of __proto__ stays a normal entry', () => {
  const store = createTicketStore();
  store.applySnapshot([issue('a')]);
  store.applyRecords([record(1, 'a'), record(2, '__proto__')]);

  const state = store.getState();

  expect(Object.hasOwn(state.issues, '__proto__')).toBe(true);
  expect(state.issues['__proto__']?.id).toBe('__proto__');
  expect(Object.hasOwn(state.issueSeq, '__proto__')).toBe(true);
  expect(state.issueSeq['__proto__']).toBe(2);
});

test('a snapshot replaces the contents and restarts seq tracking', () => {
  const store = createTicketStore();
  store.applyRecords([record(1, 'a'), record(2, 'b')]);

  store.applySnapshot([issue('c')], 40);

  expect(Object.keys(store.getState().issues)).toEqual(['c']);
  expect(store.getState().lastSeq).toBe(40);
  expect(store.getState().issueSeq).toEqual({});
});

test('applying records notifies subscribers once and reports the count', () => {
  const store = createTicketStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const report = store.applyRecords([record(1, 'a'), record(2, 'b')]);

  expect(report).toEqual({ applied: 2, needsBaseline: false });
  expect(notifications).toBe(1);
  expect(store.getState().lastSeq).toBe(2);
});

test('an empty or duplicate batch does not notify', () => {
  const store = createTicketStore();
  store.applyRecords([record(1, 'a')]);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  const report = store.applyRecords([record(1, 'a')]);

  expect(report).toEqual({ applied: 0, needsBaseline: false });
  expect(notifications).toBe(0);
});

test('a gap asks the caller for a full baseline', () => {
  const store = createTicketStore();
  store.applyRecords([record(1, 'a')]);

  const report = store.applyRecords([record(3, 'a')]);

  expect(report.needsBaseline).toBe(true);
  expect(store.getState().lastSeq).toBe(1);
});

test('applies 1000 journal records over 1000 issues within 100ms', () => {
  const issues = Array.from({ length: 1000 }, (_, index) => issue(`i${index}`));
  const records = Array.from({ length: 1000 }, (_, index) =>
    record(index + 1, `i${index}`, {
      issue: issue(`i${index}`, { title: `changed ${index}` }),
    })
  );
  const state = {
    issues: Object.fromEntries(issues.map((item) => [item.id, item])),
    lastSeq: 0,
    issueSeq: {},
  };

  const started = performance.now();
  const result = applyRecords(state, records);
  const elapsed = performance.now() - started;

  expect(result.gap).toBe(false);
  expect(result.applied).toBe(1000);
  expect(elapsed).toBeLessThan(100);
});
