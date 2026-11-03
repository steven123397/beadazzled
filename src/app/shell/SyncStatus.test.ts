import { expect, test } from 'vitest';

import type { SyncState } from '@/bindings/bd';

import { recordSyncError, type SyncErrorRecord } from './SyncStatus';

const failure: SyncState = {
  kind: 'bd-unavailable',
  error: { code: 'BD_TIMEOUT', message: 'bd timed out' },
};
const healthy: SyncState = { kind: 'healthy', lastSeq: 1, lastEventAt: null };

test('entering a failure records its code, workspace and time', () => {
  const record = recordSyncError(
    null,
    failure,
    '/repo/a',
    { kind: 'healthy', workspace: '/repo/a' },
    1000
  );

  expect(record).toMatchObject({
    code: 'BD_TIMEOUT',
    message: 'bd timed out',
    at: 1000,
    workspace: '/repo/a',
  });
});

test('a continuing failure keeps its first timestamp', () => {
  const first = recordSyncError(null, failure, '/repo/a', { kind: null, workspace: null }, 1000);

  const second = recordSyncError(
    first,
    failure,
    '/repo/a',
    { kind: 'bd-unavailable', workspace: '/repo/a' },
    2000
  );

  expect(second).toBe(first);
});

test('recovery keeps the record until a new episode starts', () => {
  const first = recordSyncError(null, failure, '/repo/a', { kind: null, workspace: null }, 1000);

  const recovered = recordSyncError(
    first,
    healthy,
    '/repo/a',
    { kind: 'bd-unavailable', workspace: '/repo/a' },
    2000
  );
  expect(recovered).toBe(first);

  const again = recordSyncError(
    recovered,
    failure,
    '/repo/a',
    { kind: 'healthy', workspace: '/repo/a' },
    3000
  );
  expect(again).not.toBe(first);
  expect(again?.at).toBe(3000);
});

test('a failure in another workspace starts a new record', () => {
  const forA = recordSyncError(null, failure, '/repo/a', { kind: null, workspace: null }, 1000);

  const forB = recordSyncError(
    forA,
    failure,
    '/repo/b',
    { kind: 'bd-unavailable', workspace: '/repo/a' },
    4000
  ) as SyncErrorRecord;

  expect(forB.workspace).toBe('/repo/b');
  expect(forB.at).toBe(4000);
});
