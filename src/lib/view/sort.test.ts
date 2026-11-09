import { expect, test } from 'vitest';

import type { Issue } from '@/bindings/bd';

import { sortIssues } from './sort';
import type { ListSort } from '@/lib/view/state';

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

function sort(by: ListSort['by'], direction: ListSort['direction']): ListSort {
  return { by, direction };
}

test('updated sorts newest first by default', () => {
  const issues = [
    issue('old', { updated_at: '2026-10-01T00:00:00Z' }),
    issue('new', { updated_at: '2026-11-01T00:00:00Z' }),
    issue('middle', { updated_at: '2026-10-15T00:00:00Z' }),
  ];

  expect(sortIssues(issues, sort('updated', 'desc')).map((item) => item.id)).toEqual([
    'new',
    'middle',
    'old',
  ]);
});

test('created supports ascending and descending order', () => {
  const issues = [
    issue('old', { created_at: '2026-10-01T00:00:00Z' }),
    issue('new', { created_at: '2026-11-01T00:00:00Z' }),
  ];

  expect(sortIssues(issues, sort('created', 'desc')).map((item) => item.id)).toEqual([
    'new',
    'old',
  ]);
  expect(sortIssues(issues, sort('created', 'asc')).map((item) => item.id)).toEqual(['old', 'new']);
});

test('priority puts P0 first when ascending', () => {
  const issues = [
    issue('p2', { priority: 2 }),
    issue('p0', { priority: 0 }),
    issue('p4', { priority: 4 }),
    issue('p1', { priority: 1 }),
  ];

  expect(sortIssues(issues, sort('priority', 'asc')).map((item) => item.id)).toEqual([
    'p0',
    'p1',
    'p2',
    'p4',
  ]);
  expect(sortIssues(issues, sort('priority', 'desc')).map((item) => item.id)).toEqual([
    'p4',
    'p2',
    'p1',
    'p0',
  ]);
});

test('title sorts case-insensitively', () => {
  const issues = [
    issue('c', { title: 'gamma' }),
    issue('a', { title: 'Alpha' }),
    issue('b', { title: 'beta' }),
  ];

  expect(sortIssues(issues, sort('title', 'asc')).map((item) => item.id)).toEqual(['a', 'b', 'c']);
});

test('id sorts numerically rather than lexicographically', () => {
  const issues = [issue('bza-10'), issue('bza-2'), issue('bza-1')];

  expect(sortIssues(issues, sort('id', 'asc')).map((item) => item.id)).toEqual([
    'bza-1',
    'bza-2',
    'bza-10',
  ]);
});

test('missing or invalid dates sort as oldest', () => {
  const issues = [
    issue('invalid', { updated_at: 'not-a-date' }),
    issue('valid', { updated_at: '2026-11-01T00:00:00Z' }),
    issue('missing', { updated_at: '' }),
  ];

  expect(sortIssues(issues, sort('updated', 'desc')).map((item) => item.id)).toEqual([
    'valid',
    'invalid',
    'missing',
  ]);
});

test('ties break by id so the order is deterministic', () => {
  const issues = [issue('c'), issue('a'), issue('b')];

  expect(sortIssues(issues, sort('updated', 'desc')).map((item) => item.id)).toEqual([
    'a',
    'b',
    'c',
  ]);
});

test('sorting does not mutate the input array', () => {
  const issues = [issue('b', { priority: 2 }), issue('a', { priority: 1 })];

  sortIssues(issues, sort('priority', 'asc'));

  expect(issues.map((item) => item.id)).toEqual(['b', 'a']);
});
