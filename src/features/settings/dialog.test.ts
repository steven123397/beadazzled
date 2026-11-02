import { expect, test, vi } from 'vitest';

const open = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => open(...args),
}));

test('a chosen file is returned as its path', async () => {
  open.mockResolvedValueOnce('C:/tools/bd.exe');
  const { pickBdExecutable } = await import('./dialog');

  await expect(pickBdExecutable()).resolves.toBe('C:/tools/bd.exe');
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }));
});

test('a cancelled dialog resolves to null', async () => {
  open.mockResolvedValueOnce(null);
  const { pickBdExecutable } = await import('./dialog');

  await expect(pickBdExecutable()).resolves.toBeNull();
});

test('a missing plugin rejects so the caller can show the error', async () => {
  open.mockRejectedValueOnce(new Error('dialog plugin is unavailable'));
  const { pickBdExecutable } = await import('./dialog');

  await expect(pickBdExecutable()).rejects.toThrow('dialog plugin is unavailable');
});
