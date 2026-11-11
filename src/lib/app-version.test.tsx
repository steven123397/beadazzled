import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { getVersion } from '@tauri-apps/api/app';

import { resetAppVersion, useAppVersion } from './app-version';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));

const mockedGetVersion = vi.mocked(getVersion);

beforeEach(() => {
  resetAppVersion();
  mockedGetVersion.mockReset();
});

test('a rejected version request can be retried by a later mount', async () => {
  mockedGetVersion
    .mockRejectedValueOnce(new Error('IPC unavailable'))
    .mockResolvedValueOnce('0.1.2');

  const first = renderHook(() => useAppVersion());
  await act(async () => {
    await Promise.resolve();
  });
  expect(first.result.current).toBeNull();
  first.unmount();

  const second = renderHook(() => useAppVersion());
  await waitFor(() => expect(second.result.current).toBe('0.1.2'));
  expect(mockedGetVersion).toHaveBeenCalledTimes(2);
});
