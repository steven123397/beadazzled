import { expect, test } from 'vitest';

import type { Dependency, Issue, WriteCommand } from '@/bindings/bd';

import { adjacentDroppableColumn, isDroppableColumn, planMove } from './move';

const TS = '2026-11-01T00:00:00Z';

function issue(
  status = 'open',
  dependencies: Dependency[] = []
): Pick<Issue, 'id' | 'status' | 'dependencies'> {
  return { id: 'bza-1', status, dependencies };
}

function blocker(id = 'bza-blocker'): Dependency[] {
  return [{ issue_id: 'bza-1', depends_on_id: id, type: 'blocks', created_at: TS }];
}

function summarize(commands: readonly WriteCommand[]): string[] {
  return commands.map((command) => {
    if ('Update' in command && typeof command.Update === 'object') {
      return `update ${command.Update.id} -s ${command.Update.status} --if-status ${command.Update.if_status}`;
    }
    if ('Close' in command && typeof command.Close === 'object') {
      return `close ${command.Close.id}`;
    }
    if ('Reopen' in command && typeof command.Reopen === 'object') {
      return `reopen ${command.Reopen.id}`;
    }
    return JSON.stringify(command);
  });
}

test('each droppable column maps to its bd command', () => {
  expect(summarize(planned(issue('deferred'), 'backlog', 'ready'))).toEqual([
    'update bza-1 -s open --if-status deferred',
  ]);
  expect(summarize(planned(issue('open'), 'ready', 'in-progress'))).toEqual([
    'update bza-1 -s in_progress --if-status open',
  ]);
  expect(summarize(planned(issue('open'), 'ready', 'backlog'))).toEqual([
    'update bza-1 -s deferred --if-status open',
  ]);
  expect(summarize(planned(issue('in_progress'), 'in-progress', 'done'))).toEqual(['close bza-1']);
});

test('a closed card reopens before taking its target status', () => {
  expect(summarize(planned(issue('closed'), 'done', 'ready'))).toEqual(['reopen bza-1']);
  expect(summarize(planned(issue('closed'), 'done', 'in-progress'))).toEqual([
    'reopen bza-1',
    'update bza-1 -s in_progress --if-status open',
  ]);
  expect(summarize(planned(issue('closed'), 'done', 'backlog'))).toEqual([
    'reopen bza-1',
    'update bza-1 -s deferred --if-status open',
  ]);
});

test('Other can move out to any real column', () => {
  expect(summarize(planned(issue('pinned'), 'other', 'ready'))).toEqual([
    'update bza-1 -s open --if-status pinned',
  ]);
  expect(summarize(planned(issue('pinned'), 'other', 'done'))).toEqual(['close bza-1']);
});

test('Blocked is never a source or a target', () => {
  expect(rejection(issue('blocked'), 'blocked', 'ready')).toEqual({ reason: 'source-blocked' });
  expect(rejection(issue('open', blocker()), 'blocked', 'in-progress')).toEqual({
    reason: 'source-blocked',
  });
  expect(rejection(issue('open'), 'ready', 'blocked')).toEqual({
    reason: 'target-not-droppable',
    column: 'blocked',
  });
  expect(rejection(issue('open'), 'ready', 'other')).toEqual({
    reason: 'target-not-droppable',
    column: 'other',
  });
});

test('dropping into the same column is a no-op', () => {
  expect(rejection(issue('open'), 'ready', 'ready')).toEqual({ reason: 'same-column' });
});

test('Ready refuses a card that still has unresolved blockers', () => {
  expect(rejection(issue('closed', blocker()), 'done', 'ready', ['bza-blocker'])).toEqual({
    reason: 'ready-blocked',
    blockers: ['bza-blocker'],
  });
});

test('the status guard blocks in_progress and closed targets only', () => {
  expect(rejection(issue('open', blocker()), 'ready', 'in-progress', ['bza-blocker'])).toEqual({
    reason: 'blocked-by-dependencies',
    blockers: ['bza-blocker'],
  });
  expect(rejection(issue('open', blocker()), 'ready', 'done', ['bza-blocker'])).toEqual({
    reason: 'blocked-by-dependencies',
    blockers: ['bza-blocker'],
  });
  // Backlog is not a guarded target: an open issue with blockers can be
  // deferred, and it will simply derive back to Blocked.
  expect(summarize(planned(issue('open', blocker()), 'ready', 'backlog', ['bza-blocker']))).toEqual(
    ['update bza-1 -s deferred --if-status open']
  );
});

test('keyboard step skips Blocked and Other and stops at the edges', () => {
  expect(adjacentDroppableColumn('backlog', 'right')).toBe('ready');
  expect(adjacentDroppableColumn('ready', 'left')).toBe('backlog');
  expect(adjacentDroppableColumn('ready', 'right')).toBe('in-progress');
  expect(adjacentDroppableColumn('in-progress', 'right')).toBe('done');
  expect(adjacentDroppableColumn('done', 'right')).toBeNull();
  expect(adjacentDroppableColumn('in-progress', 'left')).toBe('ready');
  // Blocked has no position in the droppable order; callers reject it first.
  expect(adjacentDroppableColumn('blocked', 'right')).toBeNull();
  expect(adjacentDroppableColumn('blocked', 'left')).toBeNull();
  // Other sits after Done, so left reaches Done and right has no target.
  expect(adjacentDroppableColumn('other', 'left')).toBe('done');
  expect(adjacentDroppableColumn('other', 'right')).toBeNull();
});

test('only Backlog, Ready, In Progress and Done accept drops', () => {
  expect(isDroppableColumn('backlog')).toBe(true);
  expect(isDroppableColumn('ready')).toBe(true);
  expect(isDroppableColumn('in-progress')).toBe(true);
  expect(isDroppableColumn('done')).toBe(true);
  expect(isDroppableColumn('blocked')).toBe(false);
  expect(isDroppableColumn('other')).toBe(false);
});

function planned(
  subject: Pick<Issue, 'id' | 'status' | 'dependencies'>,
  source: Parameters<typeof planMove>[1],
  target: Parameters<typeof planMove>[2],
  blockers: readonly string[] = []
): readonly WriteCommand[] {
  const plan = planMove(subject, source, target, blockers);
  expect(plan.ok).toBe(true);
  return plan.ok ? plan.commands : [];
}

function rejection(
  subject: Pick<Issue, 'id' | 'status' | 'dependencies'>,
  source: Parameters<typeof planMove>[1],
  target: Parameters<typeof planMove>[2],
  blockers: readonly string[] = []
): unknown {
  const plan = planMove(subject, source, target, blockers);
  expect(plan.ok).toBe(false);
  return plan.ok ? null : plan.rejection;
}
