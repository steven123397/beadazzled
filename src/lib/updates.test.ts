import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.check,
}));

import {
  checkForUpdate,
  getLastUpdateError,
  getUpdateState,
  installUpdate,
  resetUpdates,
} from './updates';

beforeEach(() => {
  resetUpdates();
  mocks.check.mockReset();
});

test('no update leaves the app current', async () => {
  mocks.check.mockResolvedValue(null);

  await checkForUpdate();

  expect(getUpdateState()).toMatchObject({ kind: 'current' });
});

test('an available update installs and reports progress', async () => {
  const downloadAndInstall = vi.fn(async () => undefined);
  mocks.check.mockResolvedValue({ version: '0.1.1', downloadAndInstall });

  await checkForUpdate();
  expect(getUpdateState()).toMatchObject({ kind: 'available', version: '0.1.1' });

  await installUpdate();

  expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  expect(getUpdateState()).toMatchObject({ kind: 'installed' });
});

test('a failed check keeps the reason for the About section and diagnostics', async () => {
  mocks.check.mockRejectedValue(new Error('network unreachable'));

  await checkForUpdate();

  expect(getUpdateState()).toMatchObject({ kind: 'error', message: 'network unreachable' });
  expect(getLastUpdateError()?.message).toBe('network unreachable');
});

test('a background check surfaces an available update without checking UI state first', async () => {
  mocks.check.mockResolvedValue({ version: '0.2.0', downloadAndInstall: vi.fn() });

  await checkForUpdate({ background: true });

  expect(getUpdateState()).toMatchObject({ kind: 'available', version: '0.2.0' });
});

test('install does nothing without an available update', async () => {
  const downloadAndInstall = vi.fn();

  await installUpdate();

  expect(downloadAndInstall).not.toHaveBeenCalled();
  expect(getUpdateState()).toMatchObject({ kind: 'idle' });
});
