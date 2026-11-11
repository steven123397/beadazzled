import { expect, test } from 'vitest';

import type { Dependency, Issue } from '@/bindings/bd';
import { buildSearchIndex } from '@/lib/view/filter';
import { createListViewState, type ListFilter } from '@/lib/view/state';
import { makeIssue as issue, TEST_TS as TS } from '@/test/fixtures';

import { selectVisibleIssues } from './select';

function dependency(dependsOn: string, type = 'blocks'): Dependency {
  return { issue_id: 'subject', depends_on_id: dependsOn, type, created_at: TS };
}

function filter(overrides: Partial<ListFilter> = {}): ListFilter {
  return {
    query: '',
    status: [],
    priority: [],
    type: [],
    assignee: [],
    label: [],
    ready: false,
    ...overrides,
  };
}

function ids(issues: readonly Issue[]): string[] {
  return issues.map((item) => item.id);
}

test('multi-select dimensions use OR within a dimension and AND across dimensions', () => {
  const issues = [
    issue('open-bug', { status: 'open', issue_type: 'bug' }),
    issue('closed-bug', { status: 'closed', issue_type: 'bug' }),
    issue('open-task', { status: 'open', issue_type: 'task' }),
  ];

  expect(
    ids(selectVisibleIssues(issues, withFilter(filter({ status: ['open', 'closed'] }))))
  ).toEqual(['closed-bug', 'open-bug', 'open-task']);
  expect(
    ids(selectVisibleIssues(issues, withFilter(filter({ status: ['open'], type: ['bug'] }))))
  ).toEqual(['open-bug']);
});

test('priority, type, assignee and label filters each match their own field', () => {
  const issues = [
    issue('a', { priority: 0, issue_type: 'bug', assignee: 'ada', labels: ['ui', 'backend'] }),
    issue('b', { priority: 2, issue_type: 'task', labels: ['ui'] }),
  ];

  expect(ids(selectVisibleIssues(issues, withFilter(filter({ priority: [0] }))))).toEqual(['a']);
  expect(ids(selectVisibleIssues(issues, withFilter(filter({ type: ['task'] }))))).toEqual(['b']);
  expect(ids(selectVisibleIssues(issues, withFilter(filter({ assignee: ['ada'] }))))).toEqual([
    'a',
  ]);
  expect(ids(selectVisibleIssues(issues, withFilter(filter({ assignee: [''] }))))).toEqual(['b']);
  expect(ids(selectVisibleIssues(issues, withFilter(filter({ label: ['backend'] }))))).toEqual([
    'a',
  ]);
  expect(ids(selectVisibleIssues(issues, withFilter(filter({ label: ['ui'] }))))).toEqual([
    'a',
    'b',
  ]);
});

test('ready only keeps open issues whose blocking dependencies are all closed', () => {
  const issues = [
    issue('ready', { status: 'open' }),
    issue('started', { status: 'in_progress' }),
    issue('waiting', { status: 'open', dependencies: [dependency('blocker')] }),
    issue('unblocked', { status: 'open', dependencies: [dependency('done')] }),
    issue('blocker', { status: 'in_progress' }),
    issue('done', { status: 'closed' }),
  ];

  const visible = selectVisibleIssues(issues, withFilter(filter({ ready: true })));

  expect(ids(visible)).toEqual(['ready', 'unblocked']);
});

test('selectVisibleIssues filters first and then sorts', () => {
  const issues = [
    issue('old', { updated_at: '2026-10-01T00:00:00Z' }),
    issue('new', { updated_at: '2026-11-01T00:00:00Z' }),
    issue('closed', { status: 'closed', updated_at: '2026-11-02T00:00:00Z' }),
  ];

  const visible = selectVisibleIssues(issues, withFilter(filter({ status: ['open'] })));

  expect(ids(visible)).toEqual(['new', 'old']);
});

test('filtering 1000 issues stays within the 16ms budget for six combinations', () => {
  const issues = Array.from({ length: 1000 }, (_, index) =>
    issue(`bza-${index}`, {
      title: `Issue title ${index}`,
      status: index % 5 === 0 ? 'closed' : 'open',
      priority: index % 5,
      issue_type: index % 3 === 0 ? 'bug' : 'task',
      assignee: index % 4 === 0 ? 'ada' : index % 4 === 1 ? 'lin' : '',
      labels: index % 2 === 0 ? ['ui'] : ['backend'],
      updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })
  );
  const searchText = buildSearchIndex(issues);
  const filters = [
    filter({ query: 'title 999' }),
    filter({ status: ['open'] }),
    filter({ priority: [0, 1] }),
    filter({ type: ['bug'], assignee: ['ada'] }),
    filter({ label: ['ui'], query: 'issue title 1' }),
    filter({ ready: true }),
  ];

  // Warm up the JIT so the measured pass reflects the steady-state path.
  for (const current of filters) {
    selectVisibleIssues(issues, withFilter(current), { searchText });
  }

  for (const current of filters) {
    const started = performance.now();
    selectVisibleIssues(issues, withFilter(current), { searchText });
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(16);
  }
});

function withFilter(current: ListFilter) {
  return { ...createListViewState(), filter: current };
}
