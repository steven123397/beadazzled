import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Shortcut, ShortcutContext } from './types';
import { useShortcuts } from './useShortcuts';

function context(): ShortcutContext {
  return {
    navigate: vi.fn(),
    openPalette: vi.fn(),
    closeOverlay: vi.fn(),
    refresh: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}

function Harness({ shortcuts, ctx }: { shortcuts: Shortcut[]; ctx: ShortcutContext }) {
  useShortcuts(shortcuts, ctx);
  return <input aria-label="note" />;
}

test('runs a registered shortcut on keydown', () => {
  const run = vi.fn();
  render(
    <Harness
      shortcuts={[{ id: 'help', keys: '?', labelKey: 'shortcut.help', group: 'Help', run }]}
      ctx={context()}
    />
  );

  fireEvent.keyDown(window, { key: '?' });

  expect(run).toHaveBeenCalledTimes(1);
});

test('does not run a single-key shortcut while an input has focus', () => {
  const run = vi.fn();
  render(
    <Harness
      shortcuts={[{ id: 'help', keys: '?', labelKey: 'shortcut.help', group: 'Help', run }]}
      ctx={context()}
    />
  );

  const input = screen.getByLabelText('note');
  input.focus();
  fireEvent.keyDown(input, { key: '?' });

  expect(run).not.toHaveBeenCalled();
});

test('still runs modifier shortcuts inside an input', () => {
  const run = vi.fn();
  render(
    <Harness
      shortcuts={[
        { id: 'palette', keys: 'mod+k', labelKey: 'shortcut.palette', group: 'General', run },
      ]}
      ctx={context()}
    />
  );

  const input = screen.getByLabelText('note');
  input.focus();
  fireEvent.keyDown(input, { key: 'k', ctrlKey: true });

  expect(run).toHaveBeenCalledTimes(1);
});

test('runs a chord across two key presses and gives it the context', () => {
  const navigate = vi.fn();
  const ctx = { ...context(), navigate };
  render(
    <Harness
      shortcuts={[
        {
          id: 'go-list',
          keys: ['g', 'l'],
          labelKey: 'shortcut.list',
          group: 'Navigation',
          run: (context) => context.navigate('/list'),
        },
      ]}
      ctx={ctx}
    />
  );

  fireEvent.keyDown(window, { key: 'g' });
  fireEvent.keyDown(window, { key: 'l' });

  expect(navigate).toHaveBeenCalledWith('/list');
});
