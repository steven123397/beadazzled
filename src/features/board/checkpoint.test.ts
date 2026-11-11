import { expect, test } from 'vitest';

import type { Dependency, Issue, JournalRecord } from '@/bindings/bd';
import { createTicketStore } from '@/lib/sync/store';
import { makeIssue as issue, TEST_TS as TS } from '@/test/fixtures';

import { buildBoard } from './columns';

function blocks(from: string, to: string): Dependency {
  return { issue_id: from, depends_on_id: to, type: 'blocks', created_at: TS };
}

function columnFor(board: ReturnType<typeof buildBoard>, issueId: string): string | undefined {
  for (const column of board.columns) {
    if (column.cards.some((card) => card.issue.id === issueId)) {
      return column.id;
    }
  }
  return undefined;
}

function closeRecord(seq: number, subject: Issue): JournalRecord {
  return {
    seq,
    ts: TS,
    op: 'update',
    issue_id: subject.id,
    issue: { ...subject, status: 'closed', closed_at: TS, updated_at: TS },
  };
}

test('checkpoint 6: the board migrates Blocked to Ready when the last blocker closes', () => {
  const blockerA = issue('bza-blocker-a');
  const blockerB = issue('bza-blocker-b');
  const dependent = issue('bza-dependent', {
    title: 'Waiting on two blockers',
    dependencies: [
      blocks('bza-dependent', 'bza-blocker-a'),
      blocks('bza-dependent', 'bza-blocker-b'),
    ],
  });

  // A baseline as the sync engine would deliver it after the initial export.
  const store = createTicketStore();
  store.applySnapshot([blockerA, blockerB, dependent], 10);
  const initial = store.getState();
  expect(
    columnFor(buildBoard(Object.values(initial.issues), initial.issues), 'bza-dependent')
  ).toBe('blocked');

  // The CLI closes one blocker; the journal record arrives and is applied by
  // the real reducer. One blocker still remains.
  const first = store.applyRecords([closeRecord(11, blockerA)]);
  expect(first).toEqual({ applied: 1, needsBaseline: false });
  const midway = store.getState();
  expect(columnFor(buildBoard(Object.values(midway.issues), midway.issues), 'bza-dependent')).toBe(
    'blocked'
  );

  // The last blocker closes. The card derives into Ready without any board
  // action or additional bd call.
  const second = store.applyRecords([closeRecord(12, blockerB)]);
  expect(second).toEqual({ applied: 1, needsBaseline: false });
  const settled = store.getState();
  const board = buildBoard(Object.values(settled.issues), settled.issues);
  expect(columnFor(board, 'bza-dependent')).toBe('ready');
  expect(board.columns.find((column) => column.id === 'blocked')?.cards).toEqual([]);
});
