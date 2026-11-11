import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import type { DiagnosticsSnapshot, SyncState } from '@/bindings/bd';
import { AppRefreshProvider } from '@/app/shell/AppRefresh';
import { SyncStatusProvider } from '@/app/shell/SyncStatus';
import { WorkspaceProvider } from '@/app/shell/WorkspaceProvider';
import { resetAppVersion } from '@/lib/app-version';
import { renderWithI18n } from '@/test/fixtures';
import { makeWorkspace, makeWorkspaceSnapshot } from '@/test/workspace';

const getVersion = vi.fn();

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => getVersion(),
}));

// Every test renders the version hook; the default keeps it resolved.
getVersion.mockResolvedValue('0.1.0');

beforeEach(() => {
  resetAppVersion();
});

import { DiagnosticsSection } from './DiagnosticsSection';
import './messages';

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

const REPORT: DiagnosticsSnapshot = {
  bd: { kind: 'ready', path: 'C:/tools/bd.exe', version: '1.3.2' },
  workspace: 'C:/repo/alpha',
  context: {
    projectId: 'p1',
    doltMode: 'embedded',
    schemaVersion: 3,
  },
  contextError: null,
  calls: [
    { command: 'context', argv: 'context --json', durationMs: 120, exitCode: 0, errorCode: null },
    {
      command: 'export',
      argv: 'export',
      durationMs: 80,
      exitCode: 1,
      errorCode: 'BD_EXIT_NONZERO',
    },
  ],
};

const SNAPSHOT = makeWorkspaceSnapshot({
  config: { lastWorkspacePath: '/repo/alpha' },
  active: '/repo/alpha',
});

function renderSection(
  api: { load: () => Promise<DiagnosticsSnapshot> },
  copy = vi.fn(async (text: string) => {
    void text;
    return 'copied' as const;
  })
) {
  renderWithI18n(
    <SyncStatusProvider
      state={{ kind: 'healthy', lastSeq: 42, lastEventAt: null } satisfies SyncState}
    >
      <WorkspaceProvider workspace={makeWorkspace({ snapshot: SNAPSHOT })}>
        <AppRefreshProvider value={{ lastRefreshAt: NOW, refresh: vi.fn() }}>
          <DiagnosticsSection api={api} copy={copy} />
        </AppRefreshProvider>
      </WorkspaceProvider>
    </SyncStatusProvider>
  );
  return { copy };
}

test('the report is not fetched until the user asks', () => {
  const load = vi.fn(async () => REPORT);
  renderSection({ load });

  expect(load).not.toHaveBeenCalled();
  expect(
    screen.getByText('Building the report runs bd context once; nothing runs until you ask.')
  ).toBeInTheDocument();
});

test('a loaded report shows the context and the recorded calls', async () => {
  const load = vi.fn(async () => REPORT);
  renderSection({ load });

  fireEvent.click(screen.getByRole('button', { name: 'Load diagnostics' }));

  expect(await screen.findByText('embedded')).toBeInTheDocument();
  expect(screen.getByText('p1')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Recent bd calls' })).toBeInTheDocument();
  expect(screen.getByText('context')).toBeInTheDocument();
  expect(screen.getByText('BD_EXIT_NONZERO')).toBeInTheDocument();
});

test('copying builds the fixed report and includes context values', async () => {
  const { copy } = renderSection({ load: async () => REPORT });
  // Let the version hook resolve before the copy builds its text.
  await act(async () => undefined);

  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

  await waitFor(() => expect(copy).toHaveBeenCalledTimes(1));
  const text = copy.mock.calls[0][0];
  expect(text.split('\n')).toEqual([
    'beadazzled 0.1.0',
    'bd 1.3.2 at C:/tools/bd.exe',
    'workspace: C:/repo/alpha',
    'project: p1 · dolt_mode=embedded · schema=3',
    `sync: healthy · lastSeq=42 · lastRefresh=${new Date(NOW).toISOString()}`,
    'error: -',
  ]);
});

test('an empty call history says so instead of rendering an empty table', async () => {
  renderSection({
    load: async () => ({
      ...REPORT,
      context: null,
      contextError: null,
      calls: [],
    }),
  });

  fireEvent.click(screen.getByRole('button', { name: 'Load diagnostics' }));

  expect(await screen.findByText('No bd calls recorded yet.')).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Recent bd calls' })).not.toBeInTheDocument();
});

test('a failed load is visible and copying does nothing', async () => {
  const { copy } = renderSection({
    load: async () => {
      throw { code: 'INTERNAL', message: 'bridge is gone' };
    },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Load diagnostics' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('bridge is gone');
  fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
  await waitFor(() => expect(copy).not.toHaveBeenCalled());
});

test('a context failure is reported inside the section', async () => {
  renderSection({
    load: async () => ({
      ...REPORT,
      context: null,
      contextError: {
        code: 'WS_NOT_BEADS',
        message: 'this directory is not a beads workspace',
      },
    }),
  });

  fireEvent.click(screen.getByRole('button', { name: 'Load diagnostics' }));

  expect(
    await screen.findByText(
      'bd context failed: WS_NOT_BEADS — this directory is not a beads workspace'
    )
  ).toBeInTheDocument();
});
