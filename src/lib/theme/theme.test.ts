import { expect, test } from 'vitest';

import { withThrowingLocalStorage } from '@/test/storage';

import { applyTheme, loadTheme, resolveTheme, saveTheme, type Theme } from './theme';

function withMatchMedia(prefersDark: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: prefersDark && query.includes('dark'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

test('system follows the media query', () => {
  expect(resolveTheme('system', true)).toBe('dark');
  expect(resolveTheme('system', false)).toBe('light');
});

test('explicit choices win over the system preference', () => {
  expect(resolveTheme('light', true)).toBe('light');
  expect(resolveTheme('dark', false)).toBe('dark');
});

test('applying a theme toggles the class and color-scheme', () => {
  applyTheme(document.documentElement, 'dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe('dark');

  applyTheme(document.documentElement, 'light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe('light');
});

test('the preference is persisted and survives a reload', () => {
  saveTheme('dark');
  expect(loadTheme()).toBe('dark');

  saveTheme('system');
  expect(loadTheme()).toBe('system');
});

test('an unknown stored preference falls back to system', () => {
  localStorage.setItem('beadazzled.theme', 'sepia');
  expect(loadTheme()).toBe('system');
});

test('theme preference can be read while system is the default', () => {
  localStorage.removeItem('beadazzled.theme');
  const restore = withMatchMedia(true);
  try {
    expect(loadTheme()).toBe('system');
    expect(resolveTheme(loadTheme() as Theme, true)).toBe('dark');
  } finally {
    restore();
  }
});

test('a storage that throws on read or write degrades to the default theme', () => {
  const readOnly = {
    getItem: () => {
      throw new Error('security error');
    },
    setItem: () => undefined,
  } as unknown as Storage;
  expect(loadTheme(readOnly)).toBe('system');

  const unwritable = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
  } as unknown as Storage;
  expect(() => saveTheme('dark', unwritable)).not.toThrow();
});

test('a throwing window.localStorage getter degrades instead of crashing', () => {
  withThrowingLocalStorage(() => {
    expect(loadTheme()).toBe('system');
    expect(() => saveTheme('dark')).not.toThrow();
  });
});
