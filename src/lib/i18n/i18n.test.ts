import { expect, test } from 'vitest';

import { catalogs, loadLanguage, saveLanguage, translate, type MessageKey } from './index';
import { en } from './en';
import { zhCN } from './zh-CN';

test('en and zh-CN expose the same key set', () => {
  expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
});

test('no catalog value is empty or a placeholder', () => {
  for (const [language, catalog] of Object.entries(catalogs)) {
    for (const [key, value] of Object.entries(catalog)) {
      expect(value.trim(), `${language}:${key}`).not.toBe('');
      expect(value, `${language}:${key}`).not.toMatch(/^TODO|^TBD/);
    }
  }
});

test('placeholders are declared and always substituted', () => {
  const known = new Set([
    '{id}',
    '{attempt}',
    '{found}',
    '{min}',
    '{count}',
    '{visible}',
    '{total}',
    '{version}',
    '{theme}',
    '{language}',
    '{path}',
    '{paths}',
    '{view}',
    '{seq}',
    '{state}',
    '{time}',
    '{error}',
    '{ids}',
    '{label}',
    '{alt}',
  ]);

  for (const [language, catalog] of Object.entries(catalogs)) {
    for (const [key, value] of Object.entries(catalog)) {
      const placeholders = value.match(/\{[a-zA-Z]+\}/g) ?? [];
      for (const placeholder of placeholders) {
        expect(known, `${language}:${key} uses unknown ${placeholder}`).toContain(placeholder);
      }
      if (placeholders.length > 0) {
        const vars = Object.fromEntries(
          placeholders.map((placeholder) => [placeholder.slice(1, -1), 'X'])
        );
        expect(translate(language as keyof typeof catalogs, key as MessageKey, vars)).not.toMatch(
          /\{[a-zA-Z]+\}/
        );
      }
    }
  }
});

test('translate interpolates variables', () => {
  expect(translate('en', 'status.reconnecting', { attempt: 3 })).toBe('Reconnecting (attempt 3)');
  expect(translate('zh-CN', 'status.reconnecting', { attempt: 3 })).toBe('正在重连（第 3 次）');
});

test('translate falls back to the key so missing strings are visible', () => {
  expect(translate('en', 'missing.key' as MessageKey)).toBe('missing.key');
});

test('zh-CN actually translates the shell copy', () => {
  expect(zhCN['nav.list']).not.toBe(en['nav.list']);
  expect(zhCN['welcome.title']).toMatch(/[一-鿿]/);
});

test('a storage that throws on read or write degrades to the default language', () => {
  const readOnly = {
    getItem: () => {
      throw new Error('security error');
    },
    setItem: () => undefined,
  } as unknown as Storage;
  expect(loadLanguage(readOnly)).toBe('en');

  const unwritable = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
  } as unknown as Storage;
  expect(() => saveLanguage('zh-CN', unwritable)).not.toThrow();
});

test('a throwing window.localStorage getter degrades instead of crashing', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError');
    },
  });

  try {
    expect(loadLanguage()).toBe('en');
    expect(() => saveLanguage('zh-CN')).not.toThrow();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(window, 'localStorage');
    } else {
      Object.defineProperty(window, 'localStorage', descriptor);
    }
  }
});
