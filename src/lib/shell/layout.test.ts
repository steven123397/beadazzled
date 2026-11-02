import { expect, test } from 'vitest';

import { loadSidebarCollapsed, SIDEBAR_STORAGE_KEY, saveSidebarCollapsed } from './layout';

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

test('a fresh profile starts expanded', () => {
  expect(loadSidebarCollapsed(memoryStorage())).toBe(false);
});

test('a stored collapsed flag is restored', () => {
  expect(loadSidebarCollapsed(memoryStorage({ [SIDEBAR_STORAGE_KEY]: 'true' }))).toBe(true);
  expect(loadSidebarCollapsed(memoryStorage({ [SIDEBAR_STORAGE_KEY]: 'false' }))).toBe(false);
});

test('an unrecognised stored value falls back to expanded', () => {
  expect(loadSidebarCollapsed(memoryStorage({ [SIDEBAR_STORAGE_KEY]: 'yes' }))).toBe(false);
  expect(loadSidebarCollapsed(memoryStorage({ [SIDEBAR_STORAGE_KEY]: '' }))).toBe(false);
});

test('saveSidebarCollapsed round-trips the flag', () => {
  const storage = memoryStorage();

  saveSidebarCollapsed(true, storage);
  expect(storage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
  expect(loadSidebarCollapsed(storage)).toBe(true);

  saveSidebarCollapsed(false, storage);
  expect(loadSidebarCollapsed(storage)).toBe(false);
});

test('a storage that throws on read or write degrades instead of crashing', () => {
  const throwingRead = memoryStorage();
  throwingRead.getItem = () => {
    throw new Error('security error');
  };
  expect(loadSidebarCollapsed(throwingRead)).toBe(false);

  const throwingWrite = memoryStorage();
  throwingWrite.setItem = () => {
    throw new Error('quota exceeded');
  };
  expect(() => saveSidebarCollapsed(true, throwingWrite)).not.toThrow();
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
    expect(loadSidebarCollapsed()).toBe(false);
    expect(() => saveSidebarCollapsed(true)).not.toThrow();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(window, 'localStorage');
    } else {
      Object.defineProperty(window, 'localStorage', descriptor);
    }
  }
});
