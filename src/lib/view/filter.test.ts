import { expect, test } from 'vitest';

import type { Issue } from '@/bindings/bd';

import { buildSearchIndex, hasActiveFilters, matchesFilter } from './filter';
import type { ListFilter } from './state';

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

test('text search matches id, title and labels case-insensitively', () => {
  const subject = issue('BZA-42', { title: 'Fix Scroll Jank', labels: ['Performance'] });

  expect(matchesFilter(subject, filter({ query: 'bza-42' }))).toBe(true);
  expect(matchesFilter(subject, filter({ query: 'scroll' }))).toBe(true);
  expect(matchesFilter(subject, filter({ query: 'performance' }))).toBe(true);
});

test('text search does not match the description in v0.1.0', () => {
  const subject = issue('a', { description: 'secret body text' });

  expect(matchesFilter(subject, filter({ query: 'secret' }))).toBe(false);
});

test('a precomputed search index is used when supplied', () => {
  const subject = issue('a', { title: 'Visible title' });
  const searchText = new Map([['a', 'alias only']]);

  expect(matchesFilter(subject, filter({ query: 'alias' }), { searchText })).toBe(true);
  expect(matchesFilter(subject, filter({ query: 'visible' }), { searchText })).toBe(false);
});

test('buildSearchIndex indexes id, title and labels but not description', () => {
  const index = buildSearchIndex([
    issue('BZA-1', { title: 'Fix The List', labels: ['ui'], description: 'Scroll Jank' }),
  ]);

  expect(index.get('BZA-1')).toContain('bza-1');
  expect(index.get('BZA-1')).toContain('fix the list');
  expect(index.get('BZA-1')).toContain('ui');
  expect(index.get('BZA-1')).not.toContain('scroll jank');
});

test('label filtering keeps the same issue groups the dead store index exposed', () => {
  const issues = [
    issue('a', { status: 'open', priority: 1, assignee: 'ada', labels: ['ui'] }),
    issue('b', { status: 'open', priority: 2, labels: ['ui', 'backend'] }),
    issue('c', { status: 'closed', priority: 1, assignee: 'lin' }),
  ];
  const withLabel = (label: string) =>
    issues.filter((item) => matchesFilter(item, filter({ label: [label] }))).map((item) => item.id);

  expect(withLabel('ui')).toEqual(['a', 'b']);
  expect(withLabel('backend')).toEqual(['b']);
});

test('a label named constructor stays searchable and filterable', () => {
  const subject = issue('a', { labels: ['constructor'] });

  expect(matchesFilter(subject, filter({ label: ['constructor'] }))).toBe(true);
  expect(matchesFilter(subject, filter({ query: 'constructor' }))).toBe(true);
});

test('hasActiveFilters notices every filter dimension but not grouping or sorting', () => {
  expect(hasActiveFilters(filter())).toBe(false);
  expect(hasActiveFilters(filter({ query: '  ' }))).toBe(false);
  expect(hasActiveFilters(filter({ query: 'x' }))).toBe(true);
  expect(hasActiveFilters(filter({ status: ['open'] }))).toBe(true);
  expect(hasActiveFilters(filter({ priority: [0] }))).toBe(true);
  expect(hasActiveFilters(filter({ type: ['bug'] }))).toBe(true);
  expect(hasActiveFilters(filter({ assignee: [''] }))).toBe(true);
  expect(hasActiveFilters(filter({ label: ['ui'] }))).toBe(true);
  expect(hasActiveFilters(filter({ ready: true }))).toBe(true);
});
