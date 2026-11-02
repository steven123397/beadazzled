import { expect, test } from 'vitest';

import { blockWindowDrops } from './navigation-guard';

function dragEvent(type: string): Event {
  return new Event(type, { cancelable: true });
}

test('dragged links never reach the webview as a navigation', () => {
  const cleanup = blockWindowDrops();
  try {
    const over = dragEvent('dragover');
    const drop = dragEvent('drop');

    window.dispatchEvent(over);
    window.dispatchEvent(drop);

    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  } finally {
    cleanup();
  }
});

test('the guard is removed with its cleanup', () => {
  const cleanup = blockWindowDrops();
  cleanup();

  const drop = dragEvent('drop');
  window.dispatchEvent(drop);

  expect(drop.defaultPrevented).toBe(false);
});