import { expect, test } from 'vitest';

import type { Dependency, Issue } from '@/bindings/bd';

import { getBlockedBy, getBlocks, indexIssues } from './selectors';

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

function dependsOn(...ids: string[]): Dependency[] {
  return ids.map((dependsOnId) => ({
    issue_id: 'b',
    depends_on_id: dependsOnId,
    type: 'blocks',
    created_at: TS,
  }));
}

function relation(issueId: string, dependsOnId: string, type: string): Dependency {
  return { issue_id: issueId, depends_on_id: dependsOnId, type, created_at: TS };
}

test('blocked by lists the targets of this issue dependencies in edge order', () => {
  const index = indexIssues([
    issue('a'),
    issue('c'),
    issue('b', { dependencies: dependsOn('c', 'a') }),
  ]);

  expect(getBlockedBy(index, 'b').map((ref) => ref.id)).toEqual(['c', 'a']);
});

test('blocked by keeps a target that is not in the store and marks it unresolved', () => {
  const index = indexIssues([issue('b', { dependencies: dependsOn('gone') })]);

  expect(getBlockedBy(index, 'b')).toEqual([{ id: 'gone', issue: undefined }]);
});

test('blocks scans every issue for an edge pointing at this one', () => {
  const index = indexIssues([
    issue('a'),
    issue('b', { dependencies: dependsOn('a') }),
    issue('c', { dependencies: dependsOn('a') }),
  ]);

  expect(getBlocks(index, 'a').map((ref) => ref.issue?.title)).toEqual(['Issue b', 'Issue c']);
  expect(getBlocks(index, 'b')).toEqual([]);
});

test('a target outside the store still appears in the blocks list', () => {
  const index = indexIssues([issue('b', { dependencies: dependsOn('gone') })]);

  expect(getBlocks(index, 'gone')).toEqual([{ id: 'b', issue: index.byId['b'] }]);
});

test('duplicate edges are listed once per target', () => {
  const index = indexIssues([issue('a'), issue('b', { dependencies: dependsOn('a', 'a') })]);

  expect(getBlockedBy(index, 'b').map((ref) => ref.id)).toEqual(['a']);
  expect(getBlocks(index, 'a').map((ref) => ref.id)).toEqual(['b']);
});

test('blocks is sorted by id, not by the order the store was scanned', () => {
  const index = indexIssues([
    issue('z', { dependencies: dependsOn('a') }),
    issue('a'),
    issue('c', { dependencies: dependsOn('a') }),
    issue('m', { dependencies: dependsOn('a') }),
  ]);

  expect(getBlocks(index, 'a').map((ref) => ref.id)).toEqual(['c', 'm', 'z']);
});

test('blocks uses the shared numeric collator for issue ids', () => {
  const index = indexIssues([
    issue('BZA-10', { dependencies: dependsOn('a') }),
    issue('BZA-2', { dependencies: dependsOn('a') }),
    issue('a'),
  ]);

  expect(getBlocks(index, 'a').map((ref) => ref.id)).toEqual(['BZA-2', 'BZA-10']);
});

test('only blocking relations appear in blocked by', () => {
  const index = indexIssues([
    issue('a'),
    issue('b', {
      dependencies: [
        relation('b', 'a', 'parent-child'),
        relation('b', 'c', 'related'),
        relation('b', 'd', 'blocks'),
        relation('b', 'e', 'waits-for'),
      ],
    }),
  ]);

  expect(getBlockedBy(index, 'b').map((ref) => ref.id)).toEqual(['d', 'e']);
});

test('only blocking relations appear in the blocks list', () => {
  const index = indexIssues([
    issue('a'),
    issue('b', { dependencies: [relation('b', 'a', 'parent-child')] }),
    issue('c', { dependencies: [relation('c', 'a', 'related')] }),
    issue('d', { dependencies: [relation('d', 'a', 'conditional-blocks')] }),
  ]);

  expect(getBlocks(index, 'a').map((ref) => ref.id)).toEqual(['d']);
});
