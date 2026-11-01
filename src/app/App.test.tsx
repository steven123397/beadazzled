import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';

import type { BdStatus, Issue, SyncState, WorkspaceEntry, WorkspaceSnapshot } from '@/bindings/bd';
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

function snapshot(workspaces: WorkspaceEntry[], active: string | null): WorkspaceSnapshot {
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
  };
}

const bdReady: BdStatus = { kind: 'ready', path: 'bd', version: '1.3.2' };

function fakeApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    snapshot: async () => snapshot([], null),
    bdStatus: async () => bdReady,
    setBdPath: async () => bdReady,
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

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
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

  expect(await screen.findByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p1/list');
});

test('restores a deep link and shows the sync state in the status bar', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
      syncState={healthy}
    />
  );

  expect(await screen.findByRole('heading', { name: /bza-1/ })).toBeInTheDocument();
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
});

test('escape returns from an issue route to the list', async () => {
  window.location.hash = '#/w/p1/issue/bza-1';

  render(
    <App
      workspaceApi={fakeApi({
        snapshot: async () => snapshot([entry('p1', 'alpha')], '/repo/p1'),
      })}
    />
  );
  await screen.findByRole('heading', { name: /bza-1/ });

  fireEvent.keyDown(window, { key: 'Escape' });

  expect(await screen.findByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(window.location.hash).toBe('#/w/p1/list');
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

test('keeps the shell reachable for settings without a workspace', async () => {
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

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'detail' } });
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

  render(<App workspaceApi={fakeApi()} initialTheme="light" />);
  await screen.findByRole('heading', { name: 'Settings' });
  expect(document.documentElement.classList.contains('dark')).toBe(false);

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.click(screen.getByText('Theme: Light'));

  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('beadazzled.theme')).toBe('dark');
});
