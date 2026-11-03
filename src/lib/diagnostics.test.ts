import { expect, test } from 'vitest';

import { formatDiagnostics } from './diagnostics';

test('diagnostics use the fixed six-line shape from SPEC-settings', () => {
  const text = formatDiagnostics({
    appVersion: '0.1.0',
    bdVersion: '1.3.2',
    bdPath: 'C:/tools/bd.exe',
    workspace: 'C:/repo/alpha',
    project: 'p1',
    doltMode: 'embedded',
    schema: 3,
    sync: 'healthy',
    lastSeq: 42,
    lastRefreshAt: '2026-11-01T12:00:00.000Z',
    error: null,
  });

  expect(text.split('\n')).toEqual([
    'beadazzled 0.1.0',
    'bd 1.3.2 at C:/tools/bd.exe',
    'workspace: C:/repo/alpha',
    'project: p1 · dolt_mode=embedded · schema=3',
    'sync: healthy · lastSeq=42 · lastRefresh=2026-11-01T12:00:00.000Z',
    'error: -',
  ]);
});

test('unknown values render as a dash instead of being dropped', () => {
  const text = formatDiagnostics({
    appVersion: null,
    bdVersion: null,
    bdPath: null,
    workspace: null,
    project: null,
    doltMode: null,
    schema: null,
    sync: 'loading',
    lastSeq: null,
    lastRefreshAt: null,
    error: 'BD_TIMEOUT — bd did not answer',
  });

  expect(text.split('\n')).toHaveLength(6);
  expect(text).toContain('beadazzled unknown');
  expect(text).toContain('bd unknown at -');
  expect(text).toContain('project: - · dolt_mode=- · schema=-');
  expect(text).toContain('sync: loading · lastSeq=- · lastRefresh=-');
  expect(text).toContain('error: BD_TIMEOUT — bd did not answer');
});