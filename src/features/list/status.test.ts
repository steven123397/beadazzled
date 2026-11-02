import { expect, test } from 'vitest';

import { STATUS_ORDER, statusText } from './status';

const translate = (key: string): string => `translated:${key}`;

test('known statuses have translated labels', () => {
  expect(statusText('open', translate)).toBe('translated:list.status.open');
  expect(statusText('in_progress', translate)).toBe('translated:list.status.in_progress');
  expect(statusText('closed', translate)).toBe('translated:list.status.closed');
});

test('an unknown status shows the raw value', () => {
  expect(statusText('mystery', translate)).toBe('mystery');
});

test('the canonical order matches SPEC-list', () => {
  expect(STATUS_ORDER).toEqual([
    'open',
    'in_progress',
    'blocked',
    'deferred',
    'closed',
    'pinned',
    'hooked',
  ]);
});
