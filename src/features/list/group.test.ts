import { expect, test } from 'vitest';

import { selectVisibleIssues } from '@/lib/view/select';
import { createListViewState } from '@/lib/view/state';
import { makeIssue as issue } from '@/test/fixtures';

import { groupIssues } from './group';

test('none returns a single group that preserves the input order', () => {
  const issues = [issue('b'), issue('a')];

  const groups = groupIssues(issues, 'none');

  expect(groups).toHaveLength(1);
  expect(groups[0]?.issues.map((item) => item.id)).toEqual(['b', 'a']);
});

test('status groups follow the canonical status order, unknown statuses last', () => {
  const issues = [
    issue('closed', { status: 'closed' }),
    issue('open', { status: 'open' }),
    issue('in_progress', { status: 'in_progress' }),
    issue('mystery', { status: 'mystery' }),
    issue('blocked', { status: 'blocked' }),
  ];

  const groups = groupIssues(issues, 'status');

  expect(groups.map((group) => group.key)).toEqual([
    'open',
    'in_progress',
    'blocked',
    'closed',
    'mystery',
  ]);
  expect(groups.map((group) => group.issues.length)).toEqual([1, 1, 1, 1, 1]);
});

test('priority groups sort numerically from P0', () => {
  const issues = [
    issue('p4', { priority: 4 }),
    issue('p0', { priority: 0 }),
    issue('p2', { priority: 2 }),
  ];

  const groups = groupIssues(issues, 'priority');

  expect(groups.map((group) => group.key)).toEqual(['0', '2', '4']);
});

test('type groups are alphabetical and preserve order within a group', () => {
  const issues = [
    issue('task-2', { issue_type: 'task' }),
    issue('bug', { issue_type: 'bug' }),
    issue('task-1', { issue_type: 'task' }),
  ];

  const groups = groupIssues(issues, 'type');

  expect(groups.map((group) => group.key)).toEqual(['bug', 'task']);
  expect(groups[1]?.issues.map((item) => item.id)).toEqual(['task-2', 'task-1']);
});

test('assignee groups are alphabetical with unassigned last', () => {
  const issues = [
    issue('unassigned'),
    issue('lin', { assignee: 'lin' }),
    issue('ada', { assignee: 'ada' }),
  ];

  const groups = groupIssues(issues, 'assignee');

  expect(groups.map((group) => group.key)).toEqual(['ada', 'lin', '']);
});

test('status, priority and assignee groups preserve order within each bucket', () => {
  const issues = [
    issue('a', { status: 'open', priority: 1, assignee: 'ada', labels: ['ui'] }),
    issue('b', { status: 'open', priority: 2, labels: ['ui', 'backend'] }),
    issue('c', { status: 'closed', priority: 1, assignee: 'lin' }),
  ];
  const ids = (group: 'status' | 'priority' | 'assignee', key: string) =>
    groupIssues(issues, group)
      .find((bucket) => bucket.key === key)
      ?.issues.map((item) => item.id);

  expect(ids('status', 'open')).toEqual(['a', 'b']);
  expect(ids('status', 'closed')).toEqual(['c']);
  expect(ids('priority', '1')).toEqual(['a', 'c']);
  expect(ids('assignee', 'ada')).toEqual(['a']);
  expect(ids('assignee', '')).toEqual(['b']);
});

test('filter, group and sort keep a fixed composition order', () => {
  const issues = [
    issue('open-low', { status: 'open', priority: 4 }),
    issue('closed', { status: 'closed', priority: 0 }),
    issue('open-high', { status: 'open', priority: 0 }),
    issue('open-mid', { status: 'open', priority: 2 }),
  ];
  const view = {
    ...createListViewState(),
    filter: { ...createListViewState().filter, status: ['open', 'closed'] },
    group: 'status' as const,
    sort: { by: 'priority' as const, direction: 'asc' as const },
  };

  const visible = selectVisibleIssues(issues, view);
  const groups = groupIssues(visible, view.group);

  expect(groups.map((group) => group.key)).toEqual(['open', 'closed']);
  expect(groups[0]?.issues.map((item) => item.id)).toEqual(['open-high', 'open-mid', 'open-low']);
  expect(groups[1]?.issues.map((item) => item.id)).toEqual(['closed']);
});
