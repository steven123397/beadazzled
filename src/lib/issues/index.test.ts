import { expect, test } from 'vitest';

import { makeIssue as issue } from '@/test/fixtures';

import { indexById, lookupFrom } from './index';

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

test('a plain object index never resolves through the prototype chain', () => {
  const lookup = lookupFrom({});

  expect(lookup('toString')).toBeUndefined();
  expect(lookup('__proto__')).toBeUndefined();
});
