import { expect, test } from 'vitest';

import type { Dependency, Issue } from '@/bindings/bd';

import { blockingDeps, canChangeStatus } from './guard';

function dep(dependsOn: string, type: string): Dependency {
  return {
    issue_id: 'bza-parent',
    depends_on_id: dependsOn,
    type,
    created_at: '2026-11-01T00:00:00Z',
  };
}

function issue(status: string, dependencies: Dependency[]): Pick<Issue, 'status' | 'dependencies'> {
  return { status, dependencies };
}

function statuses(entries: Record<string, string>) {
  return (id: string) => entries[id];
}

test('only blocks, conditional-blocks and waits-for count as blockers', () => {
  const blockers = blockingDeps(
    [
      dep('a', 'blocks'),
      dep('b', 'conditional-blocks'),
      dep('c', 'waits-for'),
      dep('d', 'related'),
      dep('e', 'discovered-from'),
      dep('f', 'parent-child'),
    ],
    statuses({ a: 'open', b: 'open', c: 'open', d: 'open', e: 'open', f: 'open' })
  );

  expect(blockers).toEqual(['a', 'b', 'c']);
});

test('closed blockers are not blocking', () => {
  const blockers = blockingDeps(
    [dep('a', 'blocks'), dep('b', 'blocks')],
    statuses({ a: 'closed', b: 'in_progress' })
  );

  expect(blockers).toEqual(['b']);
});

test('a blocker missing from the store counts as unresolved', () => {
  const blockers = blockingDeps([dep('missing', 'blocks')], () => undefined);

  expect(blockers).toEqual(['missing']);
});

test('no dependencies means no blockers', () => {
  expect(blockingDeps(undefined, () => 'open')).toEqual([]);
  expect(blockingDeps([], () => 'open')).toEqual([]);
});

test('in_progress and closed are denied while blockers remain', () => {
  for (const target of ['in_progress', 'closed']) {
    expect(canChangeStatus(issue('open', []), target, ['a'])).toEqual({
      allowed: false,
      reason: 'blocked-by-dependencies',
      blockers: ['a'],
    });
  }
});

test('other targets stay allowed while blockers remain', () => {
  for (const target of ['open', 'blocked', 'deferred']) {
    expect(canChangeStatus(issue('in_progress', []), target, ['a'])).toEqual({
      allowed: true,
    });
  }
});

test('without blockers every target is allowed', () => {
  expect(canChangeStatus(issue('open', []), 'closed', [])).toEqual({ allowed: true });
});

test('moving to the current status is a no-op that stays allowed', () => {
  expect(canChangeStatus(issue('in_progress', []), 'in_progress', [])).toEqual({
    allowed: true,
  });
});

test('the same decision is returned for board drags, keyboard moves and detail menus', () => {
  const blockers = blockingDeps([dep('a', 'blocks')], statuses({ a: 'open' }));
  const decision = canChangeStatus(issue('open', []), 'in_progress', blockers);

  expect(decision).toEqual({
    allowed: false,
    reason: 'blocked-by-dependencies',
    blockers: ['a'],
  });
  expect(blockers).toEqual(['a']);
});