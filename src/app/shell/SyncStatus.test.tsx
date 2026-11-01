import { expect, test } from 'vitest';

import type { SyncState } from '@/bindings/bd';

import { describeSyncState } from './SyncStatus';

test('loading distinguishes the export and journal steps', () => {
  expect(describeSyncState({ kind: 'loading', step: 'export' }).key).toBe('status.loadingIssues');
  expect(describeSyncState({ kind: 'loading', step: 'journal' }).key).toBe('status.loadingJournal');
});

test('healthy shows a positive live label', () => {
  expect(describeSyncState({ kind: 'healthy', lastSeq: 1, lastEventAt: null })).toEqual({
    key: 'status.live',
    tone: 'positive',
  });
});

test('journal-disabled is a warning', () => {
  expect(describeSyncState({ kind: 'journal-disabled' })).toEqual({
    key: 'status.journalOff',
    tone: 'warning',
  });
});

test('journal-truncated reports whether it recovered', () => {
  expect(describeSyncState({ kind: 'journal-truncated', floor: 10, recovered: true }).key).toBe(
    'status.caughtUp'
  );
  expect(describeSyncState({ kind: 'journal-truncated', floor: 10, recovered: false }).key).toBe(
    'status.rebuilding'
  );
});

test('restarting carries the attempt number', () => {
  expect(describeSyncState({ kind: 'restarting', attempt: 3 })).toEqual({
    key: 'status.reconnecting',
    tone: 'warning',
    vars: { attempt: 3 },
  });
});

test('bd-unavailable is an error', () => {
  const state: SyncState = {
    kind: 'bd-unavailable',
    error: { code: 'BD_NOT_FOUND', message: 'bd was not found' },
  };

  expect(describeSyncState(state)).toEqual({ key: 'status.bdUnavailable', tone: 'danger' });
});
