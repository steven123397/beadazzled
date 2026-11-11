import { expect, test } from 'vitest';

import type { Comment, Issue, JournalRecord } from '@/bindings/bd';
import { makeIssue as issue, TEST_TS as TS } from '@/test/fixtures';

import { applyRecords, createTicketState, type TicketState } from './reducer';

function record(
  seq: number,
  op: string,
  issueId: string,
  overrides: Partial<JournalRecord> = {}
): JournalRecord {
  return {
    seq,
    ts: `2026-11-01T00:00:${String(seq).padStart(2, '0')}Z`,
    op,
    issue_id: issueId,
    issue: null,
    ...overrides,
  };
}

function stateWith(issues: Issue[], lastSeq = 0): TicketState {
  return {
    issues: Object.fromEntries(issues.map((item) => [item.id, item])),
    lastSeq,
    issueSeq: {},
  };
}

test('create, update and close replace the whole issue', () => {
  const first = applyRecords(createTicketState(), [
    record(1, 'create', 'a', { issue: issue('a') }),
    record(2, 'update', 'a', { issue: issue('a', { title: 'Renamed' }) }),
    record(3, 'close', 'a', {
      issue: issue('a', { title: 'Renamed', status: 'closed' }),
    }),
  ]);

  expect(first.gap).toBe(false);
  expect(first.state.issues.a).toMatchObject({ title: 'Renamed', status: 'closed' });
  expect(first.state.lastSeq).toBe(3);
});

test('delete removes the issue', () => {
  const result = applyRecords(stateWith([issue('a'), issue('b')]), [record(1, 'delete', 'a')]);

  expect(result.state.issues).not.toHaveProperty('a');
  expect(result.state.issues.b).toBeDefined();
  expect(result.state.lastSeq).toBe(1);
});

test('dep records adopt a payload that carries the dependency list', () => {
  const dependencies = [{ issue_id: 'a', depends_on_id: 'b', type: 'blocks', created_at: TS }];

  const result = applyRecords(stateWith([issue('a')]), [
    record(1, 'dep_add', 'a', {
      issue: issue('a', { dependencies, dependency_count: 1 }),
    }),
  ]);

  expect(result.state.issues.a.dependency_count).toBe(1);
});

test('dep records without an issue are no-ops that still advance seq', () => {
  const result = applyRecords(stateWith([issue('a')]), [record(1, 'dep_remove', 'a')]);

  expect(result.state.issues.a).toEqual(issue('a'));
  expect(result.state.lastSeq).toBe(1);
});

test('a comment without an issue is appended once', () => {
  const comment = {
    id: 'c1',
    author: 'ada',
    text: 'Looks good',
    created_at: TS,
  };

  const result = applyRecords(stateWith([issue('a')]), [
    record(1, 'comment', 'a', { comment }),
    record(2, 'comment', 'a', { comment }),
  ]);

  const comments = result.state.issues.a.comments ?? [];
  expect(comments).toHaveLength(1);
  expect(comments[0]).toMatchObject({ id: 'c1', issue_id: 'a', text: 'Looks good' });
});

test('a comment record with a full issue replaces the issue', () => {
  const comments: Comment[] = [
    { id: 'c1', issue_id: 'a', author: 'ada', text: 'old', created_at: TS },
  ];

  const result = applyRecords(stateWith([issue('a')]), [
    record(1, 'comment', 'a', {
      issue: issue('a', { comments, comment_count: 1 }),
      comment: { id: 'c1', author: 'ada', text: 'old', created_at: TS },
    }),
  ]);

  expect(result.state.issues.a.comments).toHaveLength(1);
  expect(result.state.issues.a.comment_count).toBe(1);
});

test('an unknown op only advances the sequence', () => {
  const result = applyRecords(stateWith([issue('a')]), [
    record(1, 'something_new', 'a', { issue: issue('a', { title: 'ignored?' }) }),
  ]);

  expect(result.state.issues.a.title).toBe('Issue a');
  expect(result.state.lastSeq).toBe(1);
});

test('records at or below the last applied seq are ignored', () => {
  const state = stateWith([issue('a')], 5);

  const result = applyRecords(state, [record(5, 'delete', 'a')]);

  expect(result.state).toBe(state);
  expect(result.applied).toBe(0);
});

test('applying the same batch twice gives the same store', () => {
  const batch = [
    record(1, 'create', 'a', { issue: issue('a') }),
    record(2, 'update', 'a', { issue: issue('a', { title: 'New' }) }),
  ];
  const first = applyRecords(createTicketState(), batch);
  const second = applyRecords(first.state, batch);

  expect(second.state).toBe(first.state);
  expect(second.state).toEqual(first.state);
  expect(second.applied).toBe(0);
});

test('an older event does not roll back a newer snapshot', () => {
  const snapshotIssue = issue('a', { title: 'Snapshot', updated_at: '2026-11-01T10:00:00Z' });
  const oldEvent = record(1, 'update', 'a', {
    issue: issue('a', { title: 'Stale', updated_at: '2026-11-01T09:00:00Z' }),
  });

  const result = applyRecords(stateWith([snapshotIssue]), [oldEvent]);

  expect(result.state.issues.a.title).toBe('Snapshot');
  expect(result.state.lastSeq).toBe(1);
});

test('an equally fresh event wins on seq', () => {
  const snapshotIssue = issue('a', { title: 'Snapshot', updated_at: TS });
  const event = record(1, 'update', 'a', { issue: issue('a', { title: 'Event' }) });

  const result = applyRecords(stateWith([snapshotIssue]), [event]);

  expect(result.state.issues.a.title).toBe('Event');
});

test('a sequence gap stops applying and is reported', () => {
  const result = applyRecords(stateWith([issue('a')]), [
    record(1, 'update', 'a', { issue: issue('a', { title: 'first' }) }),
    record(3, 'update', 'a', { issue: issue('a', { title: 'gap' }) }),
  ]);

  expect(result.gap).toBe(true);
  expect(result.applied).toBe(1);
  expect(result.state.lastSeq).toBe(1);
  expect(result.state.issues.a.title).toBe('first');
});

test('the reducer tracks the last seq per issue for echo waiting', () => {
  const result = applyRecords(stateWith([issue('a')], 4), [
    record(5, 'update', 'a', { issue: issue('a') }),
    record(6, 'update', 'b', { issue: issue('b') }),
  ]);

  expect(result.state.issueSeq).toEqual({ a: 5, b: 6 });
});
test('a journal update keeps comments and dependencies from the snapshot', () => {
  const snapshot = issue('a', {
    comments: [{ id: 'c1', issue_id: 'a', author: 'ada', text: 'kept', created_at: TS }],
    comment_count: 1,
    dependencies: [{ issue_id: 'a', depends_on_id: 'b', type: 'blocks', created_at: TS }],
    dependency_count: 1,
  });

  const result = applyRecords(stateWith([snapshot]), [
    record(1, 'update', 'a', { issue: issue('a', { title: 'Renamed' }) }),
  ]);

  const stored = result.state.issues.a;
  expect(stored.title).toBe('Renamed');
  expect(stored.comments).toHaveLength(1);
  expect(stored.dependencies).toHaveLength(1);
  expect(stored.comment_count).toBe(1);
  expect(stored.dependency_count).toBe(1);
});

test('a comment record appends its comment even when the payload has an issue', () => {
  const result = applyRecords(stateWith([issue('a')]), [
    record(1, 'comment', 'a', {
      issue: issue('a', { updated_at: '2026-11-01T00:00:01Z' }),
      comment: { id: 'c9', author: 'ada', text: 'live', created_at: TS },
    }),
  ]);

  expect(result.state.issues.a.comments).toHaveLength(1);
  expect(result.state.issues.a.comment_count).toBe(1);
});

test('dependency records keep the dependency list in step', () => {
  const snapshot = issue('a', {
    dependencies: [{ issue_id: 'a', depends_on_id: 'b', type: 'blocks', created_at: TS }],
    dependency_count: 1,
  });

  const added = applyRecords(stateWith([snapshot]), [
    record(1, 'dep_add', 'a', {
      issue: issue('a', { updated_at: '2026-11-01T00:00:01Z' }),
      dep: { kind: 'blocks', target: 'c' },
    }),
  ]);
  expect(added.state.issues.a.dependencies?.map((dep) => dep.depends_on_id)).toEqual(['b', 'c']);
  expect(added.state.issues.a.dependency_count).toBe(2);

  const removed = applyRecords(added.state, [
    record(2, 'dep_remove', 'a', {
      issue: issue('a', { updated_at: '2026-11-01T00:00:02Z' }),
      dep: { kind: 'blocks', target: 'b' },
    }),
  ]);
  expect(removed.state.issues.a.dependencies?.map((dep) => dep.depends_on_id)).toEqual(['c']);
  expect(removed.state.issues.a.dependency_count).toBe(1);
});
