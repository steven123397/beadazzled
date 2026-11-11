import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { SyncState, WorkspaceSnapshot } from '@/bindings/bd';
import { AppRefreshProvider } from '@/app/shell/AppRefresh';
import { SyncStatusProvider, type SyncErrorRecord } from '@/app/shell/SyncStatus';
import { WorkspaceProvider } from '@/app/shell/WorkspaceProvider';
import { renderWithI18n } from '@/test/fixtures';
import { makeEntry, makeWorkspace, makeWorkspaceSnapshot } from '@/test/workspace';

import { SyncSection } from './SyncSection';
import './messages';

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

function snapshot(checkpoint: { seq: number; savedAt: string } | null): WorkspaceSnapshot {
  return makeWorkspaceSnapshot({
    config: {
      lastWorkspacePath: '/repo/alpha',
      workspaces: [makeEntry({ checkpoint })],
    },
    active: '/repo/alpha',
  });
}

function renderSection(
  state: SyncState,
  {
    value = snapshot({ seq: 42, savedAt: '2026-11-02T11:00:00.000Z' }),
    copy = vi.fn(async () => 'copied' as const),
    refresh = vi.fn(),
    lastError = null as SyncErrorRecord | null,
  } = {}
) {
  renderWithI18n(
    <SyncStatusProvider state={state} lastError={lastError}>
      <WorkspaceProvider workspace={makeWorkspace({ snapshot: value })}>
        <AppRefreshProvider value={{ lastRefreshAt: NOW, refresh }}>
          <SyncSection copy={copy} />
        </AppRefreshProvider>
      </WorkspaceProvider>
    </SyncStatusProvider>
  );
  return { copy, refresh };
}

test('a healthy workspace shows its position, refresh time and checkpoint', () => {
  renderSection({ kind: 'healthy', lastSeq: 42, lastEventAt: null });

  expect(screen.getByText('Live')).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByText(/42 · /)).toBeInTheDocument();
});

test('no checkpoint yet is stated instead of leaving the row blank', () => {
  renderSection({ kind: 'healthy', lastSeq: 0, lastEventAt: null }, { value: snapshot(null) });

  expect(screen.getByText('none yet')).toBeInTheDocument();
});

test('a disabled journal shows the command and copies it', async () => {
  const { copy } = renderSection({ kind: 'journal-disabled' });

  expect(screen.getByText('Real-time updates are off for this workspace.')).toBeInTheDocument();
  expect(screen.getByText('bd config set events-journal true')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));

  await waitFor(() => expect(copy).toHaveBeenCalledWith('bd config set events-journal true'));
  expect(await screen.findByText('Copied')).toBeInTheDocument();
});

test('refresh now runs the same action as Ctrl+R', () => {
  const { refresh } = renderSection({ kind: 'healthy', lastSeq: 1, lastEventAt: null });

  fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));

  expect(refresh).toHaveBeenCalledTimes(1);
});

test('a bd failure shows its code, message and detail', () => {
  renderSection(
    {
      kind: 'bd-unavailable',
      error: {
        code: 'BD_TIMEOUT',
        message: 'bd timed out after 20000ms',
        detail: { command: 'export', timeout_ms: 20000 },
      },
    },
    {
      lastError: {
        code: 'BD_TIMEOUT',
        at: NOW,
        message: 'bd timed out after 20000ms',
        workspace: '/repo/alpha',
      },
    }
  );

  expect(screen.getByText('BD_TIMEOUT — bd timed out after 20000ms')).toBeInTheDocument();
  expect(screen.getByText('Details')).toBeInTheDocument();
  expect(screen.getByText(/^at /)).toBeInTheDocument();
});

test('an error from another workspace stays hidden', () => {
  renderSection(
    { kind: 'healthy', lastSeq: 7, lastEventAt: null },
    {
      lastError: {
        code: 'BD_TIMEOUT',
        at: NOW,
        message: 'bd timed out after 20000ms',
        workspace: '/repo/beta',
      },
    }
  );

  expect(screen.queryByText('Last sync error')).not.toBeInTheDocument();
  expect(screen.queryByText('BD_TIMEOUT — bd timed out after 20000ms')).not.toBeInTheDocument();
});

test('an error that recovered stays visible with when it happened', () => {
  renderSection(
    { kind: 'healthy', lastSeq: 7, lastEventAt: null },
    {
      lastError: {
        code: 'BD_TIMEOUT',
        at: NOW,
        message: 'bd timed out after 20000ms',
        detail: { command: 'export' },
        workspace: '/repo/alpha',
      },
    }
  );

  expect(screen.getByText('Last sync error')).toBeInTheDocument();
  expect(screen.getByText('BD_TIMEOUT — bd timed out after 20000ms')).toBeInTheDocument();
  expect(screen.getByText(/^at /)).toBeInTheDocument();
  expect(screen.getByText('Details')).toBeInTheDocument();
});
