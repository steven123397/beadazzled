import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import { WorkspaceProvider } from '@/app/shell/WorkspaceProvider';
import { resetAppVersion } from '@/lib/app-version';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import { resetUpdates } from '@/lib/updates';
import { makeEntry, makeWorkspace, makeWorkspaceSnapshot } from '@/test/workspace';

import { AboutSection } from './AboutSection';
import './messages';

const getVersion = vi.fn();

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => getVersion(),
}));

vi.mock('@/lib/links', () => ({
  openExternal: vi.fn(async () => undefined),
}));

const updater = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: updater.check,
}));

beforeEach(() => {
  getVersion.mockReset();
  resetAppVersion();
  resetUpdates();
  updater.check.mockReset();
  updater.check.mockResolvedValue(null);
});

const entry = makeEntry({ path: '/repo/p1', name: 'alpha' });
const snapshot = makeWorkspaceSnapshot({
  config: { lastWorkspacePath: entry.path, workspaces: [entry] },
  active: entry.path,
});

function renderSection() {
  return render(
    <I18nProvider initialLanguage="en">
      <ThemeProvider initialPreference="system">
        <MemoryRouter>
          <WorkspaceProvider workspace={makeWorkspace({ snapshot })}>
            <AboutSection />
          </WorkspaceProvider>
        </MemoryRouter>
      </ThemeProvider>
    </I18nProvider>
  );
}

test('the app version comes from the runtime', async () => {
  getVersion.mockResolvedValue('0.1.0');
  renderSection();

  expect(await screen.findByText(/Version 0\.1\.0/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/steven123397/beadazzled'
  );
});

test('the app version request is shared across remounts', async () => {
  getVersion.mockResolvedValue('0.1.0');
  const first = renderSection();
  expect(await screen.findByText(/Version 0\.1\.0/)).toBeInTheDocument();

  first.unmount();
  renderSection();

  expect(await screen.findByText(/Version 0\.1\.0/)).toBeInTheDocument();
  expect(getVersion).toHaveBeenCalledTimes(1);
});

test('the update check is enabled and reports the latest version', async () => {
  getVersion.mockResolvedValue('0.1.0');
  renderSection();

  expect(screen.getByText('Updates are checked once after launch.')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Check for updates' });
  expect(button).toBeEnabled();

  fireEvent.click(button);

  expect(await screen.findByText('You are on the latest version.')).toBeInTheDocument();
});

test('installing an update asks first, then reports progress', async () => {
  getVersion.mockResolvedValue('0.1.0');
  const downloadAndInstall = vi.fn(async () => undefined);
  updater.check.mockResolvedValue({ version: '0.1.1', downloadAndInstall });
  renderSection();

  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

  fireEvent.click(await screen.findByRole('button', { name: 'Install 0.1.1' }));

  expect(
    screen.getByText('beadazzled will close and reopen to finish installing the update.')
  ).toBeInTheDocument();
  expect(downloadAndInstall).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Install 0.1.1 and restart' }));

  expect(await screen.findByText('Installed. The app will restart to finish.')).toBeInTheDocument();
  expect(downloadAndInstall).toHaveBeenCalledTimes(1);
});

test('cancelling the confirmation does not install the update', async () => {
  getVersion.mockResolvedValue('0.1.0');
  const downloadAndInstall = vi.fn(async () => undefined);
  updater.check.mockResolvedValue({ version: '0.1.1', downloadAndInstall });
  renderSection();

  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Install 0.1.1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.getByRole('button', { name: 'Install 0.1.1' })).toBeInTheDocument();
  expect(downloadAndInstall).not.toHaveBeenCalled();
});

test('a failed check shows the reason and leaves the button usable', async () => {
  getVersion.mockResolvedValue('0.1.0');
  updater.check.mockRejectedValue(new Error('network unreachable'));
  renderSection();

  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));

  expect(await screen.findByText('Update check failed: network unreachable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
});

test('a webview without the app plugin omits the version', async () => {
  getVersion.mockRejectedValue(new Error('plugin:app not available'));
  renderSection();

  await screen.findByRole('heading', { name: 'beadazzled' });
  expect(screen.queryByText(/Version /)).not.toBeInTheDocument();
});

test('runtime details describe the active workspace and bd', async () => {
  getVersion.mockResolvedValue('0.1.0');
  renderSection();

  await screen.findByText(/Version 0\.1\.0/);
  expect(screen.getByText('1.3.2 · bd')).toBeInTheDocument();
  expect(screen.getByText('/repo/p1')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open full diagnostics' })).toHaveAttribute(
    'href',
    '/settings/diagnostics'
  );
});
