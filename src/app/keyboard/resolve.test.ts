import { expect, test } from 'vitest';

import type { Shortcut } from './types';
import { formatKeys, isEditableTarget, keyToken, resolveShortcut } from './resolve';

const shortcuts: Shortcut[] = [
  {
    id: 'palette',
    keys: 'mod+k',
    label: 'Command palette',
    group: 'General',
    run: () => undefined,
  },
  {
    id: 'list',
    keys: 'mod+1',
    label: 'Go to List',
    group: 'Navigation',
    run: () => undefined,
  },
  {
    id: 'help',
    keys: '?',
    label: 'Keyboard help',
    group: 'Help',
    run: () => undefined,
  },
  {
    id: 'go-list',
    keys: ['g', 'l'],
    label: 'Go to List',
    group: 'Navigation',
    run: () => undefined,
  },
  {
    id: 'go-board',
    keys: ['g', 'b'],
    label: 'Go to Board',
    group: 'Navigation',
    run: () => undefined,
  },
];

test('ctrl and cmd both map to mod', () => {
  expect(keyToken({ key: 'k', ctrlKey: true })).toBe('mod+k');
  expect(keyToken({ key: 'K', metaKey: true })).toBe('mod+k');
});

test('modifier-only presses produce no token', () => {
  expect(keyToken({ key: 'Control', ctrlKey: true })).toBeNull();
  expect(keyToken({ key: 'Shift', shiftKey: true })).toBeNull();
});

test('a single-key shortcut fires outside inputs', () => {
  const result = resolveShortcut(shortcuts, { key: '?' }, { now: 100 });

  expect(result.binding?.id).toBe('help');
});

test('a single-key shortcut is ignored inside an input', () => {
  const result = resolveShortcut(shortcuts, { key: '?' }, { now: 100, editable: true });

  expect(result.binding).toBeNull();
});

test('a modifier shortcut still fires inside an input', () => {
  const result = resolveShortcut(
    shortcuts,
    { key: 'k', ctrlKey: true },
    { now: 100, editable: true }
  );

  expect(result.binding?.id).toBe('palette');
});

test('a chord resolves on its second key', () => {
  const first = resolveShortcut(shortcuts, { key: 'g' }, { now: 100 });
  expect(first.binding).toBeNull();
  expect(first.pending?.prefix).toBe('g');

  const second = resolveShortcut(shortcuts, { key: 'l' }, { now: 400, pending: first.pending });
  expect(second.binding?.id).toBe('go-list');
  expect(second.pending).toBeNull();
});

test('an expired chord does not fire', () => {
  const first = resolveShortcut(shortcuts, { key: 'g' }, { now: 100 });
  const second = resolveShortcut(shortcuts, { key: 'l' }, { now: 1200, pending: first.pending });

  expect(second.binding).toBeNull();
  expect(second.pending).toBeNull();
});

test('a chord never starts inside an input', () => {
  const first = resolveShortcut(shortcuts, { key: 'g' }, { now: 100, editable: true });

  expect(first.binding).toBeNull();
  expect(first.pending).toBeNull();
});

test('an unrelated key clears a pending chord', () => {
  const first = resolveShortcut(shortcuts, { key: 'g' }, { now: 100 });
  const second = resolveShortcut(shortcuts, { key: 'x' }, { now: 200, pending: first.pending });

  expect(second.binding).toBeNull();
  expect(second.pending).toBeNull();
});

test('alt combinations are not treated as shortcuts', () => {
  const result = resolveShortcut(shortcuts, { key: 'k', altKey: true }, { now: 100 });

  expect(result.binding).toBeNull();
});

test('editable targets are inputs, textareas and contenteditable hosts', () => {
  expect(isEditableTarget(document.createElement('input'))).toBe(true);
  expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
  expect(isEditableTarget(document.createElement('select'))).toBe(true);

  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  expect(isEditableTarget(host)).toBe(true);

  expect(isEditableTarget(document.createElement('button'))).toBe(false);
  expect(isEditableTarget(null)).toBe(false);
});

test('formatKeys renders modifiers and chords for the help panel', () => {
  expect(formatKeys('mod+k')).toBe('Ctrl+K');
  expect(formatKeys(['g', 'l'])).toBe('G then L');
  expect(formatKeys('?')).toBe('?');
  expect(formatKeys('mod+shift+arrowleft')).toBe('Ctrl+Shift+←');
});
