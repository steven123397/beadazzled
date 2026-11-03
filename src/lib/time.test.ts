import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { formatAbsoluteTime, formatDateTime, formatRelativeTime, timeOrder } from './time';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('relative time covers seconds, minutes, hours, days, months and years', () => {
  expect(formatRelativeTime('2026-11-01T23:59:30Z', 'en')).toBe('30 seconds ago');
  expect(formatRelativeTime('2026-11-01T23:30:00Z', 'en')).toBe('30 minutes ago');
  expect(formatRelativeTime('2026-11-01T21:00:00Z', 'en')).toBe('3 hours ago');
  expect(formatRelativeTime('2026-10-30T00:00:00Z', 'en')).toBe('3 days ago');
  expect(formatRelativeTime('2026-08-01T00:00:00Z', 'en')).toBe('3 months ago');
  expect(formatRelativeTime('2024-11-02T00:00:00Z', 'en')).toBe('2 years ago');
});

test('a future timestamp reads as a future event', () => {
  expect(formatRelativeTime('2026-11-04T00:00:00Z', 'en')).toBe('in 2 days');
});

test('an unparseable timestamp is shown verbatim', () => {
  expect(formatRelativeTime('not-a-date', 'en')).toBe('not-a-date');
  expect(formatAbsoluteTime('not-a-date', 'en')).toBe('not-a-date');
});

test('date and time include both the day and the clock', () => {
  const value = '2026-11-01T12:00:00Z';

  expect(formatDateTime(value, 'en')).toBe(
    new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(
      Date.parse(value)
    )
  );
  expect(formatDateTime('not-a-date', 'en')).toBe('not-a-date');
});

test('absolute time delegates to the locale formatter', () => {
  const value = '2026-11-01T12:00:00Z';

  expect(formatAbsoluteTime(value, 'en')).toBe(
    new Intl.DateTimeFormat('en').format(Date.parse(value))
  );
});

test('an unparseable timestamp sorts as the epoch instead of emitting NaN', () => {
  expect(timeOrder('not a date')).toBe(0);
  expect(timeOrder('')).toBe(0);
  expect(timeOrder('2026-11-01T00:00:00Z')).toBe(Date.parse('2026-11-01T00:00:00Z'));
});
