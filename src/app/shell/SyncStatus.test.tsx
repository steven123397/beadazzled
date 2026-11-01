import { expect, test } from 'vitest';

import type { SyncState } from '@/bindings/bd';

import { describeSyncState } from './SyncStatus';

test('loading distinguishes the export and journal steps', () => {
  expect(describeSyncState({ kind: 'loading', step: 'export' }).label).toMatch(/issues/i);
  expect(describeSyncState({ kind: 'loading', step: 'journal' }).label).toMatch(/journal/i);
});

test('healthy shows a positive live label', () => {
  expect(describeSyncState({ kind: 'healthy', lastSeq: 1, lastEventAt: null })).toEqual({
    label: 'Live',
    tone: 'positive',
  });
});

test('journal-disabled is a warning', () => {
  expect(describeSyncState({ kind: 'journal-disabled' })).toEqual({
    label: 'Journal off',
    tone: 'warning',
  });
});

test('journal-truncated reports whether it recovered', () => {
  expect(describeSyncState({ kind: 'journal-truncated', floor: 10, recovered: true }).label).toBe(
    'Caught up'
  );
  expect(describeSyncState({ kind: 'journal-truncated', floor: 10, recovered: false }).label).toBe(
    'Rebuilding'
  );
});

test('restarting includes the attempt number', () => {
  expect(describeSyncState({ kind: 'restarting', attempt: 3 })).toEqual({
    label: 'Reconnecting (attempt 3)',
    tone: 'warning',
  });
});

test('bd-unavailable is an error', () => {
  const state: SyncState = {
    kind: 'bd-unavailable',
    error: { code: 'BD_NOT_FOUND', message: 'bd was not found' },
  };

  expect(describeSyncState(state)).toEqual({ label: 'bd unavailable', tone: 'danger' });
});
