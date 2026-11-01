import { expect, test } from 'vitest';

import { formatDiagnostics } from './diagnostics';

test('diagnostics use one fixed key per line in a stable order', () => {
  const text = formatDiagnostics({
    bd: '1.3.2',
    workspace: 'C:/repo/alpha',
    project: 'p1',
    lastSeq: 42,
    sync: 'healthy',
    lastRefreshAt: '2026-11-01T12:00:00.000Z',
    pendingWrites: 2,
    error: null,
    view: '#/w/p1/list',
  });

  expect(text.split('\n')).toEqual([
    'bd: 1.3.2',
    'workspace: C:/repo/alpha',
    'projectId: p1',
    'lastSeq: 42',
    'sync: healthy',
    'lastRefresh: 2026-11-01T12:00:00.000Z',
    'pendingWrites: 2',
    'lastError: -',
    'view: #/w/p1/list',
  ]);
});

test('unknown values render as a dash instead of being dropped', () => {
  const text = formatDiagnostics({
    bd: 'unknown',
    workspace: '-',
    project: '-',
    lastSeq: 0,
    sync: 'loading',
    lastRefreshAt: null,
    pendingWrites: 0,
    error: 'disk io',
    view: '#/',
  });

  expect(text).toContain('lastRefresh: -');
  expect(text).toContain('lastError: disk io');
  expect(text.split('\n')).toHaveLength(9);
});