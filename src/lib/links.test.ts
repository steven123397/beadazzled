import { expect, test } from 'vitest';

import { isExternalUrl } from './links';

test('http and https links are external', () => {
  expect(isExternalUrl('https://example.com/docs')).toBe(true);
  expect(isExternalUrl('http://example.com')).toBe(true);
});

test('other schemes and relative targets never reach the OS handler', () => {
  expect(isExternalUrl('javascript:alert(1)')).toBe(false);
  expect(isExternalUrl('data:text/html,hi')).toBe(false);
  expect(isExternalUrl('mailto:someone@example.com')).toBe(false);
  expect(isExternalUrl('./other.md')).toBe(false);
  expect(isExternalUrl('#section')).toBe(false);
  expect(isExternalUrl(undefined)).toBe(false);
});