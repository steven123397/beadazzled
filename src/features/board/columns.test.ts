import { expect, test } from 'vitest';

import type { Issue } from '@/bindings/bd';

import { buildBoard, columnOf, filterForBoard, hasBoardFilters } from './columns';
import { createListViewState } from '@/lib/view/state';

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

function blocks(issueId: string, targetId: string): Issue['dependencies'] {
  return [{ issue_id: issueId, depends_on_id: targetId, type: 'blocks', created_at: TS }];
}

function byId(issues: readonly Issue[]): Record<string, Issue> {
  return Object.fromEntries(issues.map((entry) => [entry.id, entry]));
}

test.each([
  ['deferred is Backlog', { status: 'deferred' }, 'backlog'],
  ['open with no blockers is Ready', { status: 'open' }, 'ready'],
  ['open with a blocker is Blocked', { status: 'open' }, 'blocked'],
  ['in_progress is In Progress', { status: 'in_progress' }, 'in-progress'],
  ['hooked is In Progress', { status: 'hooked' }, 'in-progress'],
  ['closed is Done', { status: 'closed' }, 'done'],
  ['closed with a blocker is still Done', { status: 'closed' }, 'done'],
  ['blocked without dependencies is Blocked', { status: 'blocked' }, 'blocked'],
  ['blocked with dependencies is Blocked', { status: 'blocked' }, 'blocked'],
  ['pinned is Other', { status: 'pinned' }, 'other'],
  ['an unknown status is Other', { status: 'triaged' }, 'other'],
])('%s', (_name, overrides, expected) => {
  const blockers = expected === 'blocked' || expected === 'done' ? ['bza-blocker'] : [];
  expect(columnOf(issue('bza-1', overrides), blockers)).toBe(expected);
});

test('buildBoard partitions every status and hides Other when it is empty', () => {
  const issues = [
    issue('bza-deferred', { status: 'deferred' }),
    issue('bza-ready'),
    issue('bza-blocked', { dependencies: blocks('bza-blocked', 'bza-ready') }),
    issue('bza-progress', { status: 'in_progress' }),
    issue('bza-closed', { status: 'closed' }),
  ];
  const board = buildBoard(issues, byId(issues));

  expect(board.columns.map((column) => column.id)).toEqual([
    'backlog',
    'ready',
    'in-progress',
    'blocked',
    'done',
  ]);
  expect(board.columns.map((column) => column.cards.length)).toEqual([1, 1, 1, 1, 1]);
  expect(board.count).toBe(5);
});

test('Other appears only when pinned or unknown tickets exist', () => {
  const plain = [issue('bza-1')];
  expect(buildBoard(plain, byId(plain)).columns.some((column) => column.id === 'other')).toBe(
    false
  );

  const withPinned = [...plain, issue('bza-2', { status: 'pinned' })];
  const board = buildBoard(withPinned, byId(withPinned));
  const other = board.columns.find((column) => column.id === 'other');
  expect(other?.cards.map((card) => card.issue.id)).toEqual(['bza-2']);
});

test('cards sort by priority, then most recently updated', () => {
  const issues = [
    issue('bza-a', { priority: 2, updated_at: '2026-11-01T10:00:00Z' }),
    issue('bza-b', { priority: 2, updated_at: '2026-11-01T12:00:00Z' }),
    issue('bza-c', { priority: 1, updated_at: '2026-11-01T09:00:00Z' }),
    issue('bza-d', { priority: 0, updated_at: '2026-11-01T08:00:00Z' }),
  ];
  const board = buildBoard(issues, byId(issues));
  const ready = board.columns.find((column) => column.id === 'ready');
  expect(ready?.cards.map((card) => card.issue.id)).toEqual(['bza-d', 'bza-c', 'bza-b', 'bza-a']);
});

test('blocked cards carry their unresolved blockers and how they got there', () => {
  const issues = [
    issue('bza-open-blocker'),
    issue('bza-closed-blocker', { status: 'closed' }),
    issue('bza-derived', {
      dependencies: [
        ...(blocks('bza-derived', 'bza-open-blocker') ?? []),
        ...(blocks('bza-derived', 'bza-closed-blocker') ?? []),
      ],
    }),
    issue('bza-manual', { status: 'blocked' }),
  ];
  const board = buildBoard(issues, byId(issues));
  const blocked = board.columns.find((column) => column.id === 'blocked');
  const derived = blocked?.cards.find((card) => card.issue.id === 'bza-derived');
  const manual = blocked?.cards.find((card) => card.issue.id === 'bza-manual');

  // A closed target no longer blocks; a missing target would.
  expect(derived?.blockers).toEqual(['bza-open-blocker']);
  expect(derived?.manual).toBe(false);
  expect(manual?.blockers).toEqual([]);
  expect(manual?.manual).toBe(true);
});

test('a blocker outside the current filter still moves its dependent to Blocked', () => {
  const issues = [
    issue('bza-blocker', { labels: ['infra'] }),
    issue('bza-dependent', {
      labels: ['ui'],
      dependencies: blocks('bza-dependent', 'bza-blocker'),
    }),
  ];
  const filter = { ...createListViewState().filter, label: ['ui'] };
  const visible = filterForBoard(issues, filter, {
    issuesById: byId(issues),
  });

  expect(visible.map((entry) => entry.id)).toEqual(['bza-dependent']);
  const board = buildBoard(visible, byId(issues));
  expect(board.columns.find((column) => column.id === 'blocked')?.cards[0]?.issue.id).toBe(
    'bza-dependent'
  );
});

test('the board ignores the status filter but honours the other dimensions', () => {
  const issues = [
    issue('bza-open-alpha', { title: 'Alpha' }),
    issue('bza-closed-alpha', { title: 'Alpha', status: 'closed' }),
    issue('bza-open-beta', { title: 'Beta' }),
  ];
  const filter = {
    ...createListViewState().filter,
    status: ['closed'],
    query: 'alpha',
  };
  const visible = filterForBoard(issues, filter);
  expect(visible.map((entry) => entry.id)).toEqual(['bza-open-alpha', 'bza-closed-alpha']);

  const onlyStatus = { ...createListViewState().filter, status: ['closed'] };
  expect(filterForBoard(issues, onlyStatus)).toHaveLength(3);
});

test('status alone does not count as an active board filter', () => {
  const filter = createListViewState().filter;
  expect(hasBoardFilters({ ...filter, status: ['closed'] })).toBe(false);
  expect(hasBoardFilters({ ...filter, query: 'x' })).toBe(true);
});

test('partitions a 1000-card board without dropping tickets', () => {
  const issues = Array.from({ length: 1000 }, (_, index) =>
    issue(`bza-${index}`, {
      status: index % 10 === 0 ? 'closed' : index % 7 === 0 ? 'in_progress' : 'open',
      priority: index % 5,
    })
  );
  const board = buildBoard(issues, byId(issues));
  const total = board.columns.reduce((sum, column) => sum + column.cards.length, 0);
  expect(board.count).toBe(1000);
  expect(total).toBe(1000);
});
