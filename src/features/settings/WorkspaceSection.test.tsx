import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import type { WorkspaceEntry, WorkspaceSnapshot } from '@/bindings/bd';
import { WorkspaceProvider } from '@/app/shell/WorkspaceProvider';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import type { UseWorkspace } from '@/lib/workspace/useWorkspace';

import { WorkspaceSection } from './WorkspaceSection';

const TS = '2026-11-01T00:00:00Z';

function entry(path: string, overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    path,
    name: path.split('/').pop() ?? path,
    projectId: 'project-1-abcdef',
    isWorktree: false,
    lastOpenedAt: TS,
    checkpoint: null,
    ...overrides,
  };
}

function snapshot(
  workspaces: WorkspaceEntry[],
  active: string | null,
  missing: string[] = []
): WorkspaceSnapshot {
  return {
    config: {
      schemaVersion: 1,
      bdPath: null,
      language: 'en',
      theme: 'system',
      lastWorkspacePath: active,
      workspaces,
    },
    missing,
    active,
    corruptBackup: null,
  };
}

function workspace(overrides: Partial<UseWorkspace> = {}): UseWorkspace {
  return {
    snapshot: snapshot([], null),
    bd: { kind: 'ready', path: 'bd', version: '1.3.2' },
    loading: false,
    error: null,
    reload: vi.fn(),
    refreshBd: vi.fn(),
    add: vi.fn(async () => true),
    switchTo: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    relocate: vi.fn(async () => true),
    setBdPath: vi.fn(async () => null),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderSection(
  value: UseWorkspace,
  pickDirectory: () => Promise<string | null> = async () => null
) {
  return render(
    <I18nProvider initialLanguage="en">
      <MemoryRouter initialEntries={['/settings']}>
        <WorkspaceProvider workspace={value}>
          <WorkspaceSection pickDirectory={pickDirectory} />
          <LocationProbe />
        </WorkspaceProvider>
      </MemoryRouter>
    </I18nProvider>
  );
}

test('every registered workspace shows its identity and badges', () => {
  const active = entry('/repo/alpha');
  const other = entry('/repo/beta', { isWorktree: true });
  renderSection(workspace({ snapshot: snapshot([active, other], '/repo/alpha') }));

  expect(screen.getByText('alpha')).toBeInTheDocument();
  expect(screen.getByText('beta')).toBeInTheDocument();
  expect(screen.getByText('Current')).toBeInTheDocument();
  expect(screen.getByText('worktree')).toBeInTheDocument();
  expect(screen.getAllByText(/project project-/)).toHaveLength(2);
  expect(screen.getByText('/repo/alpha')).toBeInTheDocument();
});

test('a missing workspace is marked and cannot be opened', () => {
  const gone = entry('/repo/gone');
  renderSection(workspace({ snapshot: snapshot([gone], null, ['/repo/gone']) }));

  expect(screen.getByText('missing')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
});

test('adding a workspace hands the picked directory to the registry', async () => {
  const add = vi.fn(async () => true);
  renderSection(workspace({ add }), async () => '/repo/new');

  fireEvent.click(screen.getByRole('button', { name: 'Add workspace…' }));

  await waitFor(() => expect(add).toHaveBeenCalledWith('/repo/new'));
});

test('opening another workspace switches, then lands on its list', async () => {
  const active = entry('/repo/alpha');
  const other = entry('/repo/beta', { projectId: 'project-2-abcdef' });
  const switchTo = vi.fn(async () => true);
  renderSection(workspace({ snapshot: snapshot([active, other], '/repo/alpha'), switchTo }));

  fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]);

  await waitFor(() => expect(switchTo).toHaveBeenCalledWith('/repo/beta'));
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent('/w/project-2-abcdef/list')
  );
});

test('removing asks first and only drops the entry', async () => {
  const remove = vi.fn(async () => true);
  renderSection(workspace({ snapshot: snapshot([entry('/repo/alpha')], '/repo/alpha'), remove }));

  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

  const dialog = screen.getByRole('dialog', { name: 'Remove workspace?' });
  expect(within(dialog).getByText(/Nothing on disk is deleted/)).toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

  await waitFor(() => expect(remove).toHaveBeenCalledWith('/repo/alpha'));
});

test('cancelling the confirmation keeps the workspace', () => {
  const remove = vi.fn(async () => true);
  renderSection(workspace({ snapshot: snapshot([entry('/repo/alpha')], '/repo/alpha'), remove }));

  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(remove).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('relocating keeps the entry and uses the newly picked directory', async () => {
  const relocate = vi.fn(async () => true);
  renderSection(
    workspace({ snapshot: snapshot([entry('/repo/alpha')], '/repo/alpha'), relocate }),
    async () => '/repo/moved'
  );

  fireEvent.click(screen.getByRole('button', { name: 'Relocate…' }));

  await waitFor(() => expect(relocate).toHaveBeenCalledWith('/repo/alpha', '/repo/moved'));
});

test('a picker failure is shown instead of doing nothing', async () => {
  renderSection(workspace(), async () => {
    throw new Error('dialog plugin is unavailable');
  });

  fireEvent.click(screen.getByRole('button', { name: 'Add workspace…' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('dialog plugin is unavailable');
});
