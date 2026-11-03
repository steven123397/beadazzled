import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { BdStatus, WorkspaceSnapshot } from '@/bindings/bd';
import { WorkspaceProvider } from '@/app/shell/WorkspaceProvider';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import type { UseWorkspace } from '@/lib/workspace/useWorkspace';

import { BdSection } from './BdSection';

const READY: BdStatus = { kind: 'ready', path: 'C:/tools/bd.exe', version: '1.3.2' };

function snapshot(bdPath: string | null): WorkspaceSnapshot {
  return {
    config: {
      schemaVersion: 1,
      bdPath,
      language: 'en',
      theme: 'system',
      lastWorkspacePath: null,
      workspaces: [],
    },
    missing: [],
    active: null,
    corruptBackup: null,
  };
}

function workspace(overrides: Partial<UseWorkspace> = {}): UseWorkspace {
  return {
    snapshot: snapshot(null),
    bd: READY,
    loading: false,
    error: null,
    reload: vi.fn(),
    refreshBd: vi.fn(),
    add: vi.fn(),
    switchTo: vi.fn(),
    remove: vi.fn(),
    relocate: vi.fn(),
    setBdPath: vi.fn(async () => READY),
    ...overrides,
  };
}

function renderSection(
  value: UseWorkspace,
  props: {
    pickFile?: () => Promise<string | null>;
    copy?: () => Promise<'copied' | 'failed'>;
  } = {}
) {
  return render(
    <I18nProvider initialLanguage="en">
      <WorkspaceProvider workspace={value}>
        <BdSection
          pickFile={props.pickFile ?? (async () => null)}
          copy={props.copy ?? (async () => 'copied' as const)}
        />
      </WorkspaceProvider>
    </I18nProvider>
  );
}

test('a ready bd shows its version, path and resolution source', () => {
  renderSection(workspace({ snapshot: snapshot('C:/tools/bd.exe') }));

  expect(screen.getByText('bd 1.3.2')).toBeInTheDocument();
  expect(screen.getByText('Path: C:/tools/bd.exe')).toBeInTheDocument();
  expect(screen.getByText('Configured path')).toBeInTheDocument();
});

test('a bd found on PATH says so', () => {
  renderSection(workspace({ snapshot: snapshot(null) }));

  expect(screen.getByText('Found on PATH')).toBeInTheDocument();
});

test('a missing bd shows the winget command and copies it', async () => {
  const copy = vi.fn(async () => 'copied' as const);
  renderSection(
    workspace({
      bd: { kind: 'not-found', searched: ['C:/bin/bd.exe'] },
      snapshot: snapshot(null),
    }),
    { copy }
  );

  expect(screen.getByText('winget install --id GasTownHall.Beads -e')).toBeInTheDocument();
  expect(screen.getByText('Looked in: C:/bin/bd.exe')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));

  await waitFor(() =>
    expect(copy).toHaveBeenCalledWith('winget install --id GasTownHall.Beads -e')
  );
  expect(await screen.findByText('Copied')).toBeInTheDocument();
});

test('an unsupported version names both versions', () => {
  renderSection(
    workspace({
      bd: { kind: 'unsupported', path: 'C:/bd.exe', found: '1.2.0', min: '1.3.2' },
    })
  );

  expect(screen.getByText('bd 1.2.0 is older than the required 1.3.2.')).toBeInTheDocument();
});

test('choosing a file hands the path to the workspace service', async () => {
  const setBdPath = vi.fn(async () => READY);
  renderSection(workspace({ setBdPath }), {
    pickFile: async () => 'D:/tools/bd.exe',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Choose bd…' }));

  await waitFor(() => expect(setBdPath).toHaveBeenCalledWith('D:/tools/bd.exe'));
});

test('a rejected path is explained while the effective bd stays ready', async () => {
  const rejected: BdStatus = { kind: 'not-found', searched: ['D:/nope/bd.exe'] };
  renderSection(
    workspace({
      snapshot: snapshot('C:/tools/bd.exe'),
      setBdPath: async () => rejected,
    }),
    { pickFile: async () => 'D:/nope/bd.exe' }
  );

  fireEvent.click(screen.getByRole('button', { name: 'Choose bd…' }));

  expect(await screen.findByText('The chosen bd was rejected.')).toBeVisible();
  expect(screen.getByText('No bd was found at D:/nope/bd.exe.')).toBeVisible();
  // The previous entry is still what the app runs on, so it keeps its panel.
  expect(screen.getByText('bd 1.3.2')).toBeInTheDocument();
  expect(screen.getByText('Configured path')).toBeInTheDocument();
});

test('a failure stored by the workspace hook is shown', () => {
  renderSection(workspace({ error: 'bd probe crashed' }));

  expect(screen.getByRole('alert')).toHaveTextContent('bd probe crashed');
});

test('a picker failure is shown instead of silently doing nothing', async () => {
  renderSection(workspace(), {
    pickFile: async () => {
      throw new Error('dialog plugin is unavailable');
    },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Choose bd…' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('dialog plugin is unavailable');
});

test('detect again asks the workspace service to probe', async () => {
  const refreshBd = vi.fn(async () => undefined);
  renderSection(workspace({ refreshBd }));

  fireEvent.click(screen.getByRole('button', { name: 'Detect again' }));

  await waitFor(() => expect(refreshBd).toHaveBeenCalledTimes(1));
});

test('clearing the configured path falls back to PATH lookup', async () => {
  const setBdPath = vi.fn(async () => READY);
  renderSection(workspace({ snapshot: snapshot('C:/tools/bd.exe'), setBdPath }));

  fireEvent.click(screen.getByRole('button', { name: 'Use the bd on PATH' }));

  await waitFor(() => expect(setBdPath).toHaveBeenCalledWith(null));
});
