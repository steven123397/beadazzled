import { expect, test } from 'vitest';

import type { Issue } from '@/bindings/bd';

import { indexById, lookupFrom } from './index';

const TS = '2026-11-01T00:00:00Z';

function issue(id: string): Issue {
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
  };
}

test('lookupFrom returns the issue and undefined for an id that is gone', () => {
  const lookup = lookupFrom(indexById([issue('a')]));

  expect(lookup('a')?.title).toBe('Issue a');
  expect(lookup('missing')).toBeUndefined();
});

test('an issue id of constructor stays a normal lookup', () => {
  const lookup = lookupFrom(indexById([issue('constructor')]));

  expect(lookup('constructor')?.id).toBe('constructor');
  expect(lookup('toString')).toBeUndefined();
});

test('an issue id of __proto__ stays a normal entry', () => {
  const byId = indexById([issue('__proto__')]);
  const lookup = lookupFrom(byId);

  expect(Object.hasOwn(byId, '__proto__')).toBe(true);
  expect(lookup('__proto__')?.id).toBe('__proto__');
});

test('an absent index produces an empty lookup', () => {
  expect(lookupFrom(undefined)('a')).toBeUndefined();
});
