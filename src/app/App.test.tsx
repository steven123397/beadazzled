import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';

import type { BdStatus, Issue, SyncState, WorkspaceEntry, WorkspaceSnapshot } from '@/bindings/bd';
import { setDraftGuard } from '@/lib/draft-guard';
import type { SyncApi, SyncEvent, SyncSnapshot } from '@/lib/sync/api';
import type { WorkspaceApi } from '@/lib/workspace/api';

import { App } from './App';

function issue(id: string, title: string): Issue {
  return {
    id,
    title,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
  };
}

/** Pick a status from the detail rail's popover. */
function chooseStatus(option: RegExp) {
  const details = document.querySelector<HTMLDetailsElement>('details[aria-label="Status"]');
  if (details === null) {
    throw new Error('no Status menu');
  }
  details.open = true;
  fireEvent.click(within(details).getByRole('radio', { name: option }));
}

function entry(projectId: string, name = projectId): WorkspaceEntry {
  return {
    path: `/repo/${projectId}`,
    name,
    projectId,
    isWorktree: false,
    lastOpenedAt: '2026-11-01T00:00:00Z',
    checkpoint: null,
  };
}

function snapshot(
  workspaces: WorkspaceEntry[],
  active: string | null,
  extra: Partial<WorkspaceSnapshot> = {}
): WorkspaceSnapshot {
  return {
    config: {
      schemaVersion: 1,
      bdPath: null,
      language: 'en',
      theme: 'system',
      lastWorkspacePath: null,
      workspaces,
    },
    missing: [],
    active,
    corruptBackup: null,
    ...extra,
  };
}

const bdReady: BdStatus = { kind: 'ready', path: 'bd', version: '1.3.2' };

function fakeApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    snapshot: async () => snapshot([], null),
    bdStatus: async () => bdReady,
    setBdPath: async () => bdReady,
    setPreferences: async (language, theme) => ({
      ...snapshot([], null).config,
      language,
      theme,
    }),
    add: async () => entry('p1'),
    switchTo: async () => entry('p1'),
    remove: async () => true,
    relocate: async () => entry('p1'),
    setCheckpoint: async () => true,
    checkpoint: async () => null,
    flush: async () => undefined,
    ...overrides,
  };
}

const healthy: SyncState = { kind: 'healthy', lastSeq: 42, lastEventAt: null };

function fakeSyncApi() {
  const handlers = new Map<SyncEvent, (payload: unknown) => void>();
  const start = vi.fn(async () => undefined);
  const refresh = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const api: SyncApi = {
    start,
    refresh,
    stop,
    listen: async <T,>(event: SyncEvent, handler: (payload: T) => void) => {
      handlers.set(event, handler as (payload: unknown) => void);
      return () => {
        handlers.delete(event);
      };
    },
  };

  return {
    api,
    start,
    emit: (event: SyncEvent, payload: unknown) => handlers.get(event)?.(payload),
  };
}

beforeAll(async () => {
  // The first render of a lazy route pays its chunk transform. Under a loaded
  // worker that one-off cost can outlast the test's wait budget and read as a
  // routing failure (bza-ryr.52), so load the chunks once per file. Each test
  // then measures routing instead of module loading.
  await Promise.all([
    import('@/features/detail/DetailView'),
    import('@/features/board/BoardView'),
    import('@/features/settings/SettingsView'),
  ]);
});

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.classList.remove('dark');
});

test('shows the welcome screen when no workspace is registered', async () => {
  window.location.hash = '#/welcome';

  render(<App workspaceApi={fakeApi()} />);

  expect(await screen.findByRole('heading', { name: /welcome/i })).toBeInTheDocument();
});

test('redirects the root to the active workspace list', async () => {
  window.location.hash = '#/';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );

  expect(
    await screen.findByRole('heading', { name: 'List' }, { timeout: 3000 })
  ).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p1/list');
});

test('restores a deep link and shows the sync state in the status bar', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      issues={[issue('bza-1', 'Deep linked')]}
      syncState={healthy}
    />
  );

  expect(
    await screen.findByRole('heading', { name: 'Deep linked' }, { timeout: 3000 })
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Status bar')).toHaveTextContent('Live');
});

test('falls back to welcome when the deep link names an unknown workspace', async () => {
  window.location.hash = '#/w/missing/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );

  expect(await screen.findByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  expect(screen.getByText('That workspace is no longer available.')).toBeInTheDocument();
});

test('a deep link to a registered non-active workspace switches to it', async () => {
  window.location.hash = '#/w/p2/list';
  let data = snapshot([entry('p1', 'alpha'), entry('p2', 'beta')], '/repo/p1');
  const switchTo = vi.fn(async (path: string) => {
    data = snapshot(data.config.workspaces, path);
    return entry('p2', 'beta');
  });

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => data,
        switchTo,
      })}
    />
  );

  expect(await screen.findByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(screen.getByLabelText('Status bar')).toHaveTextContent('beta');
  expect(window.location.hash).toBe('#/w/p2/list');
  expect(switchTo).toHaveBeenCalledWith('/repo/p2');
});

test('a bare project route redirects to its list', async () => {
  window.location.hash = '#/w/p1';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );

  expect(await screen.findByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p1/list');
});

test('welcome with an active workspace redirects to the list', async () => {
  window.location.hash = '#/welcome';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );

  expect(await screen.findByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p1/list');
});

test('escape returns from an issue route to the list', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      issues={[issue('bza-1', 'Deep linked')]}
    />
  );
  await screen.findByRole('heading', { name: 'Deep linked' }, { timeout: 3000 });

  fireEvent.keyDown(window, { key: 'Escape' });

  expect(await screen.findByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p1/list');
});

test('escape closes an overlay without leaving the issue route', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      issues={[issue('bza-1', 'Deep linked')]}
    />
  );
  await screen.findByRole('heading', { name: 'Deep linked' }, { timeout: 3000 });

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'Escape' });

  expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Deep linked' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p1/issue/bza-1');
});

test('a workspace load failure is visible in the shell', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => {
          throw new Error('disk io');
        },
      })}
    />
  );

  expect(await screen.findByLabelText('Status bar')).toHaveTextContent('disk io');
});

test('shows a busy skeleton instead of an empty list while the workspace loads', async () => {
  window.location.hash = '#/w/p1/list';

  render(<App workspaceApi={fakeApi({ snapshot: () => new Promise(() => undefined) })} />);

  expect(screen.getByRole('status', { name: 'Loading workspace' })).toHaveAttribute(
    'aria-busy',
    'true'
  );
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('shows the winget command when bd is missing', async () => {
  window.location.hash = '#/welcome';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([], null),
        bdStatus: async () => ({ kind: 'not-found', searched: [] }),
      })}
    />
  );

  expect(await screen.findByText(/bd was not found/i)).toBeInTheDocument();
  expect(screen.getByText('winget install --id GasTownHall.Beads -e')).toBeInTheDocument();
});

test('settings stays reachable without a workspace', async () => {
  window.location.hash = '#/settings';

  render(<App workspaceApi={fakeApi()} />);

  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
});

test('ctrl+k opens the palette and searches tickets', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      issues={[issue('bza-9xy', 'Detail reading')]}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();

  fireEvent.change(screen.getByRole('combobox', { name: 'Search commands and tickets' }), {
    target: { value: 'detail' },
  });
  expect(screen.getByText('Detail reading')).toBeInTheDocument();
});

test('the help panel is generated from the shortcut registry', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  fireEvent.keyDown(window, { key: '?' });

  const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
  expect(dialog).toHaveTextContent('Command palette');
  expect(dialog).toHaveTextContent('Ctrl+K');
});

test('switching language from the palette updates the shell instantly', async () => {
  window.location.hash = '#/settings';

  render(<App workspaceApi={fakeApi()} />);
  await screen.findByRole('heading', { name: 'Settings' });

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.click(screen.getByText('Language: English'));

  expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '设置' })).toBeInTheDocument();
  expect(localStorage.getItem('beadazzled.language')).toBe('zh-CN');
});

test('the theme action applies the new theme immediately', async () => {
  window.location.hash = '#/settings';

  // The registry is the source of truth, so the light preference has to come
  // from the snapshot rather than from the prop.
  const light = snapshot([], null);
  light.config.theme = 'light';
  render(<App workspaceApi={fakeApi({ snapshot: async () => light })} />);
  await screen.findByRole('heading', { name: 'Settings' });
  expect(document.documentElement.classList.contains('dark')).toBe(false);

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  await waitFor(() => expect(screen.getByText('Theme: Light')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Theme: Light'));

  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('beadazzled.theme')).toBe('dark');
});

test('production sync wiring feeds the status bar and ticket search', async () => {
  window.location.hash = '#/w/p1/list';
  const sync = fakeSyncApi();

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncEnabled
      syncApi={sync.api}
    />
  );
  await waitFor(() => expect(sync.start).toHaveBeenCalledWith('/repo/p1'));

  act(() => {
    sync.emit('state', healthy);
    sync.emit('snapshot', {
      issues: [issue('bza-9xy', 'Detail reading')],
      since: 0,
    } satisfies SyncSnapshot);
  });

  expect(await screen.findByLabelText('Status bar')).toHaveTextContent('Live');

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.change(screen.getByRole('combobox', { name: 'Search commands and tickets' }), {
    target: { value: 'detail' },
  });
  expect(screen.getByText('Detail reading')).toBeInTheDocument();
});

test('a workspace whose bd is missing shows the list unavailable state', async () => {
  window.location.hash = '#/w/p1/list';
  const sync = fakeSyncApi();

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
        bdStatus: async () => ({ kind: 'not-found', searched: [] }),
      })}
      syncEnabled
      syncApi={sync.api}
    />
  );

  await waitFor(() =>
    expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'bd-unavailable')
  );
  expect(screen.getByRole('alert')).toHaveTextContent('bd is unavailable');
  expect(screen.getByText('bd was not found on PATH.')).toBeInTheDocument();
  expect(sync.start).not.toHaveBeenCalled();
});

test('a workspace whose directory is gone never renders its list', async () => {
  window.location.hash = '#/';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () =>
          snapshot([entry('p1', 'alpha')], '/repo/p1', { missing: ['/repo/p1'] }),
      })}
    />
  );

  expect(await screen.findByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  expect(screen.getByText('That workspace is no longer available.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'List' })).not.toBeInTheDocument();
});

test('a deep link to a workspace whose directory is gone does not switch to it', async () => {
  window.location.hash = '#/w/p1/list';
  const switchTo = vi.fn(async () => entry('p1'));

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () =>
          snapshot([entry('p1', 'alpha'), entry('p2', 'beta')], '/repo/p2', {
            missing: ['/repo/p1'],
          }),
        switchTo,
      })}
    />
  );

  expect(await screen.findByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  expect(screen.getByText('That workspace is no longer available.')).toBeInTheDocument();
  expect(switchTo).not.toHaveBeenCalled();
});

test('welcome names the workspaces that are missing and the corrupt config backup', async () => {
  window.location.hash = '#/welcome';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () =>
          snapshot([entry('p1', 'alpha')], null, {
            missing: ['/repo/p1'],
            corruptBackup: 'C:/cfg/config.json.corrupt-1',
          }),
      })}
    />
  );

  expect(await screen.findByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  expect(screen.getByText(/\/repo\/p1/)).toBeInTheDocument();
  expect(screen.getByText(/C:\/cfg\/config\.json\.corrupt-1/)).toBeInTheDocument();
});

test('a healthy snapshot shows no missing or corrupt notices', async () => {
  window.location.hash = '#/welcome';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );

  await screen.findByRole('heading', { name: 'List' });
  expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/damaged/i)).not.toBeInTheDocument();
});

test('ctrl+b collapses the sidebar and the choice survives a restart', async () => {
  window.location.hash = '#/w/p1/list';
  const api = fakeApi({ snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1') });
  const first = render(<App workspaceApi={api} />);
  await screen.findByRole('heading', { name: 'List' });

  fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

  expect(document.querySelector('#app-sidebar')).toHaveAttribute('data-collapsed', 'true');
  expect(localStorage.getItem('beadazzled.sidebar.collapsed')).toBe('true');

  first.unmount();
  render(<App workspaceApi={api} />);
  await screen.findByRole('heading', { name: 'List' });

  expect(document.querySelector('#app-sidebar')).toHaveAttribute('data-collapsed', 'true');
});

test('an unrecognised stored sidebar value falls back to expanded', async () => {
  window.location.hash = '#/w/p1/list';
  localStorage.setItem('beadazzled.sidebar.collapsed', 'garbage');

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  expect(screen.getByRole('complementary', { name: 'Sidebar' })).toHaveAttribute(
    'data-collapsed',
    'false'
  );
});

test('a collapsed sidebar gets out of the way and the top bar toggle restores it', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  const sidebar = screen.getByRole('complementary', { name: 'Sidebar' });
  fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

  expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));

  expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  expect(within(sidebar).getByRole('link', { name: 'List' })).toBeInTheDocument();
});

async function openDiagnostics() {
  const statusBar = screen.getByLabelText('Status bar');
  fireEvent.click(within(statusBar).getByRole('button'));
  return screen.findByRole('dialog', { name: 'Diagnostics' });
}

test('clicking the status bar shows bd, workspace, journal position and refresh time', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncState={healthy}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  const dialog = await openDiagnostics();

  expect(dialog).toHaveTextContent('bd: 1.3.2');
  expect(dialog).toHaveTextContent('workspace: /repo/p1');
  expect(dialog).toHaveTextContent('projectId: p1');
  expect(dialog).toHaveTextContent('Journal position: 42');
  expect(dialog).toHaveTextContent('Last refresh:');
  expect(dialog).toHaveTextContent('Pending writes: 0');
});

test('escape and the backdrop both close the diagnostics dialog', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  await openDiagnostics();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Diagnostics' })).not.toBeInTheDocument();

  await openDiagnostics();
  fireEvent.click(document.querySelector('[data-diagnostics-backdrop]') as HTMLElement);
  expect(screen.queryByRole('dialog', { name: 'Diagnostics' })).not.toBeInTheDocument();
});

test('an overlay closes with escape while a draft is open behind it', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  // The detail editor arms this guard while a draft is open; single-key
  // shortcuts are suppressed then, but Escape must still reach the overlay.
  setDraftGuard(() => true);
  try {
    await openDiagnostics();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Diagnostics' })).not.toBeInTheDocument();
  } finally {
    setDraftGuard(null);
  }
});

test('browser back with a draft open asks and keeps the page', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      issues={[issue('bza-1', 'Deep linked')]}
    />
  );
  await screen.findByRole('heading', { name: 'Deep linked' }, { timeout: 3000 });

  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  // The detail page arms this while an editor holds an unsaved draft.
  setDraftGuard(() => window.confirm('Discard the unsaved draft?'));
  try {
    window.location.hash = '#/w/p1/list';
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#/w/p1/issue/bza-1');
    expect(screen.getByRole('heading', { name: 'Deep linked' })).toBeInTheDocument();
  } finally {
    setDraftGuard(null);
    confirm.mockRestore();
  }
});

test('opening diagnostics never calls bd again', async () => {
  window.location.hash = '#/w/p1/list';
  const bdStatus = vi.fn(async () => bdReady);

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
        bdStatus,
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });
  bdStatus.mockClear();

  await openDiagnostics();

  expect(bdStatus).not.toHaveBeenCalled();
});

test('the copied diagnostics text has a fixed shape and carries no secrets', async () => {
  window.location.hash = '#/w/p1/list';
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncState={healthy}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  const dialog = await openDiagnostics();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy diagnostics' }));

  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const text = writeText.mock.calls[0]?.[0] ?? '';
  const lines = text.split('\n');
  expect(lines).toHaveLength(6);
  // jsdom has no Tauri app plugin, so the version line says unknown.
  expect(lines[0]).toBe('beadazzled unknown');
  expect(lines[1]).toBe('bd 1.3.2 at bd');
  expect(lines[2]).toBe('workspace: /repo/p1');
  expect(lines[3]).toContain('dolt_mode=-');
  expect(lines[4]).toMatch(/^sync: healthy · lastSeq=42 · lastRefresh=.+$/);
  expect(lines[5]).toBe('error: -');
  // The real guarantee is structural — formatDiagnostics emits six fixed
  // fields — so this stays a tripwire against a future field that leaks one.
  expect(text).not.toMatch(/token|secret|password|key/i);
});

test('sync state changes are announced politely', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncState={healthy}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  const live = screen.getByText('Live');
  expect(live).toHaveAttribute('aria-live', 'polite');
});

test('a failed copy tells the user instead of doing nothing', async () => {
  window.location.hash = '#/w/p1/list';
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async () => {
        throw new Error('permission denied');
      },
    },
    configurable: true,
  });
  Object.defineProperty(document, 'execCommand', {
    value: () => {
      throw new Error('unsupported');
    },
    configurable: true,
  });

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  const dialog = await openDiagnostics();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy diagnostics' }));

  expect(
    await screen.findByText(/Copy failed/, { selector: '[role="status"]' })
  ).toBeInTheDocument();
  Reflect.deleteProperty(document, 'execCommand');
});

test('a refresh keeps the routed view mounted instead of flashing the skeleton', async () => {
  window.location.hash = '#/w/p1/list';
  let snapshots = 0;
  const api = fakeApi({
    snapshot: async () => {
      snapshots += 1;
      if (snapshots === 1) {
        return snapshot([entry('p1', 'alpha')], '/repo/p1');
      }
      return new Promise<WorkspaceSnapshot>(() => undefined);
    },
  });
  render(<App workspaceApi={api} />);
  await screen.findByRole('heading', { name: 'List' });

  fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
  await waitFor(() => expect(snapshots).toBe(2));

  expect(screen.getByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Loading workspace' })).not.toBeInTheDocument();
});

test('opening a workspace from the welcome blocker leaves the screen', async () => {
  window.location.hash = '#/';
  let data = snapshot([entry('p1', 'alpha'), entry('p2', 'beta')], '/repo/p1', {
    missing: ['/repo/p1'],
  });
  const switchTo = vi.fn(async (path: string) => {
    data = snapshot(data.config.workspaces, path);
    return entry('p2', 'beta');
  });

  render(<App workspaceApi={fakeApi({ snapshot: async () => data, switchTo })} />);

  expect(await screen.findByRole('heading', { name: /welcome/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /beta/ }));

  expect(await screen.findByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p2/list');
});

test('the palette shortcut does not stack on top of diagnostics', async () => {
  window.location.hash = '#/w/p1/list';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: 'List' });

  await openDiagnostics();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

  expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Diagnostics' })).toBeInTheDocument();
});

test('a title edit waits for the journal echo before the page changes', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';
  const sync = fakeSyncApi();
  const execute = vi.fn(async () => ({ ok: true as const, createdId: null }));

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncEnabled
      syncApi={sync.api}
      writesApi={{ execute }}
    />
  );

  await waitFor(() => expect(sync.start).toHaveBeenCalledWith('/repo/p1'));

  act(() => {
    sync.emit('state', healthy);
    sync.emit('snapshot', {
      issues: [issue('bza-1', 'Old title')],
      since: 42,
    } satisfies SyncSnapshot);
  });

  const heading = await screen.findByRole(
    'heading',
    { level: 1, name: 'Old title' },
    { timeout: 3000 }
  );
  expect(heading).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'New title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute).toHaveBeenCalledWith('/repo/p1', {
    Update: expect.objectContaining({ id: 'bza-1', title: 'New title' }),
  });
  // Saved but not echoed: the editor is still pending and the old title is
  // not replaced optimistically.
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

  act(() => {
    sync.emit('records', [
      {
        seq: 43,
        ts: '2026-11-01T00:00:00Z',
        op: 'update',
        issue_id: 'bza-1',
        issue: issue('bza-1', 'New title'),
      },
    ]);
  });

  expect(
    await screen.findByRole('heading', { level: 1, name: 'New title' }, { timeout: 3000 })
  ).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
});

test('a status conflict is visible and triggers a baseline refresh', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';
  const sync = fakeSyncApi();
  const execute = vi.fn(async () => ({
    ok: false as const,
    error: { code: 'WRITE_CONFLICT' as const, message: 'stale' },
  }));

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncEnabled
      syncApi={sync.api}
      writesApi={{ execute }}
    />
  );

  await waitFor(() => expect(sync.start).toHaveBeenCalledWith('/repo/p1'));
  act(() => {
    sync.emit('state', healthy);
    sync.emit('snapshot', {
      issues: [issue('bza-1', 'Conflict target')],
      since: 42,
    } satisfies SyncSnapshot);
  });

  await screen.findByRole('heading', { level: 1, name: 'Conflict target' }, { timeout: 3000 });

  chooseStatus(/In progress/);

  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This issue changed elsewhere; refreshing the view.'
  );
  await waitFor(() => expect(vi.mocked(sync.api.refresh)).toHaveBeenCalled());
});

test('a board move writes through App and waits for the journal echo', async () => {
  window.location.hash = '#/w/p1/board';
  const sync = fakeSyncApi();
  const execute = vi.fn(async () => ({ ok: true as const, createdId: null }));

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncEnabled
      syncApi={sync.api}
      writesApi={{ execute }}
    />
  );

  await waitFor(() => expect(sync.start).toHaveBeenCalledWith('/repo/p1'));

  act(() => {
    sync.emit('state', healthy);
    sync.emit('snapshot', {
      issues: [issue('bza-1', 'Board ticket')],
      since: 42,
    } satisfies SyncSnapshot);
  });

  await screen.findByRole('heading', { name: 'Board' }, { timeout: 3000 });
  const columnText = (id: string) =>
    document.querySelector(`[data-column-id="${id}"] header`)?.textContent ?? '';
  // jsdom measures zero-height scroll containers, so assert on the derived
  // column counts rather than virtualized card nodes.
  await waitFor(() => expect(columnText('ready')).toContain('1'));

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(execute).toHaveBeenCalledWith('/repo/p1', {
    Update: expect.objectContaining({ id: 'bza-1', status: 'in_progress', if_status: 'open' }),
  });
  // Not optimistic: the ticket is still in Ready while the echo is pending.
  expect(columnText('ready')).toContain('1');
  expect(columnText('in-progress')).toContain('0');

  act(() => {
    sync.emit('records', [
      {
        seq: 43,
        ts: '2026-11-01T00:00:00Z',
        op: 'update',
        issue_id: 'bza-1',
        issue: { ...issue('bza-1', 'Board ticket'), status: 'in_progress' },
      },
    ]);
  });

  await waitFor(() => expect(columnText('in-progress')).toContain('1'));
  expect(columnText('ready')).toContain('0');
});

test('a board move conflict is visible and triggers a baseline refresh', async () => {
  window.location.hash = '#/w/p1/board';
  const sync = fakeSyncApi();
  const execute = vi.fn(async () => ({
    ok: false as const,
    error: { code: 'WRITE_CONFLICT' as const, message: 'stale' },
  }));

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncEnabled
      syncApi={sync.api}
      writesApi={{ execute }}
    />
  );

  await waitFor(() => expect(sync.start).toHaveBeenCalledWith('/repo/p1'));
  act(() => {
    sync.emit('state', healthy);
    sync.emit('snapshot', {
      issues: [issue('bza-1', 'Board conflict')],
      since: 42,
    } satisfies SyncSnapshot);
  });

  await screen.findByRole('heading', { name: 'Board' }, { timeout: 3000 });
  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This issue changed elsewhere; refreshing the view.'
  );
  // One attempt, no retry, and the ticket has not moved.
  expect(execute).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-column-id="ready"] header')?.textContent ?? '').toContain(
    '1'
  );
  await waitFor(() => expect(vi.mocked(sync.api.refresh)).toHaveBeenCalled());
});
