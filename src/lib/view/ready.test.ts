import { expect, test } from 'vitest';

import type { Dependency, Issue } from '@/bindings/bd';

import { blockingDeps, isReady } from './ready';

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

function dependency(dependsOn: string, type = 'blocks'): Dependency {
  return {
    issue_id: 'subject',
    depends_on_id: dependsOn,
    type,
    created_at: TS,
  };
}

function lookup(issues: readonly Issue[]): (id: string) => Issue | undefined {
  const byId = new Map(issues.map((item) => [item.id, item]));
  return (id) => byId.get(id);
}

test('blockingDeps includes blocks, conditional-blocks and waits-for targets', () => {
  const subject = issue('subject', {
    dependencies: [
      dependency('a', 'blocks'),
      dependency('b', 'conditional-blocks'),
      dependency('c', 'waits-for'),
    ],
  });

  expect(blockingDeps(subject, lookup([issue('a'), issue('b'), issue('c')]))).toEqual([
    'a',
    'b',
    'c',
  ]);
});

test('two edges to the same open target count once', () => {
  const subject = issue('subject', {
    dependencies: [dependency('a', 'blocks'), dependency('a', 'waits-for')],
  });

  expect(blockingDeps(subject, lookup([issue('a')]))).toEqual(['a']);
});

test('a closed dependency target does not block', () => {
  const subject = issue('subject', {
    dependencies: [dependency('done'), dependency('still-open')],
  });

  const statusOf = lookup([
    issue('done', { status: 'closed' }),
    issue('still-open', { status: 'open' }),
  ]);

  expect(blockingDeps(subject, statusOf)).toEqual(['still-open']);
});

test('a dependency target missing from the store counts as unfinished', () => {
  const subject = issue('subject', { dependencies: [dependency('gone')] });

  expect(blockingDeps(subject, lookup([]))).toEqual(['gone']);
});

test('related, parent-child and other non-blocking edges never block', () => {
  const subject = issue('subject', {
    dependencies: [
      dependency('a', 'related'),
      dependency('b', 'relates-to'),
      dependency('c', 'parent-child'),
      dependency('d', 'discovered-from'),
      dependency('e', 'duplicates'),
      dependency('f', 'supersedes'),
      dependency('g', 'caused-by'),
      dependency('h', 'validates'),
      dependency('i', 'tracks'),
    ],
  });

  expect(blockingDeps(subject, lookup([]))).toEqual([]);
});

test('isReady requires status open and an empty blocking dependency set', () => {
  expect(isReady(issue('a'), lookup([]))).toBe(true);
  expect(isReady(issue('a', { status: 'in_progress' }), lookup([]))).toBe(false);
  expect(isReady(issue('a', { status: 'blocked' }), lookup([]))).toBe(false);
  expect(
    isReady(
      issue('a', { dependencies: [dependency('b')] }),
      lookup([issue('b', { status: 'open' })])
    )
  ).toBe(false);
  expect(
    isReady(
      issue('a', { dependencies: [dependency('b')] }),
      lookup([issue('b', { status: 'closed' })])
    )
  ).toBe(true);
});
