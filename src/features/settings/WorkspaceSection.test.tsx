import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import type { WorkspaceEntry, WorkspaceSnapshot } from '@/bindings/bd';
import { WorkspaceProvider } from '@/app/shell/WorkspaceProvider';
import { renderWithI18n } from '@/test/fixtures';
import type { UseWorkspace } from '@/lib/workspace/useWorkspace';
import { makeEntry, makeWorkspace as workspace, makeWorkspaceSnapshot } from '@/test/workspace';

import { WorkspaceSection } from './WorkspaceSection';
import './messages';

function entry(path: string, overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return makeEntry({ path, projectId: 'project-1-abcdef', ...overrides });
}

function snapshot(
  workspaces: WorkspaceEntry[],
  active: string | null,
  missing: string[] = []
): WorkspaceSnapshot {
  return makeWorkspaceSnapshot({
    config: { lastWorkspacePath: active, workspaces },
    active,
    missing,
  });
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderSection(
  value: UseWorkspace,
  pickDirectory: () => Promise<string | null> = async () => null
) {
  return renderWithI18n(
    <MemoryRouter initialEntries={['/settings']}>
      <WorkspaceProvider workspace={value}>
        <WorkspaceSection pickDirectory={pickDirectory} />
        <LocationProbe />
      </WorkspaceProvider>
    </MemoryRouter>
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

test('opening another workspace switches, then resolves the route from the registry', async () => {
  const active = entry('/repo/alpha');
  const other = entry('/repo/beta', { projectId: 'project-2-abcdef' });
  const switchTo = vi.fn(async () => true);
  renderSection(workspace({ snapshot: snapshot([active, other], '/repo/alpha'), switchTo }));

  fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]);

  await waitFor(() => expect(switchTo).toHaveBeenCalledWith('/repo/beta'));
  // The switch may have revalidated the project id, so the shell resolves the
  // active workspace's route rather than the id captured before the switch.
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
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
