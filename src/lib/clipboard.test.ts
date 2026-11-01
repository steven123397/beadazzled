import { afterEach, expect, test, vi } from 'vitest';

import { copyText } from './clipboard';

function setClipboard(clipboard: Partial<Clipboard> | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  setClipboard(undefined);
  Reflect.deleteProperty(document, 'execCommand');
});

test('copies through the clipboard API when it is available', async () => {
  const writeText = vi.fn(async () => undefined);
  setClipboard({ writeText });

  await expect(copyText('bd: 1.3.2')).resolves.toBe('copied');
  expect(writeText).toHaveBeenCalledWith('bd: 1.3.2');
});

test('falls back to execCommand when the clipboard API rejects', async () => {
  setClipboard({
    writeText: async () => {
      throw new Error('denied');
    },
  });
  const execCommand = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

  await expect(copyText('bd: 1.3.2')).resolves.toBe('copied');
  expect(execCommand).toHaveBeenCalledWith('copy');
  expect(document.querySelector('textarea')).toBeNull();
});

test('reports failure instead of throwing when every path fails', async () => {
  setClipboard(undefined);
  Object.defineProperty(document, 'execCommand', {
    value: () => {
      throw new Error('unsupported');
    },
    configurable: true,
  });

  await expect(copyText('bd: 1.3.2')).resolves.toBe('failed');
  expect(document.querySelector('textarea')).toBeNull();
});

test('reports failure when the fallback is refused', async () => {
  setClipboard(undefined);
  Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });

  await expect(copyText('bd: 1.3.2')).resolves.toBe('failed');
});