import { expect, test } from 'vitest';

import { memoryStorage, withThrowingLocalStorage } from '@/test/storage';

import { loadSidebarCollapsed, SIDEBAR_STORAGE_KEY, saveSidebarCollapsed } from './layout';

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
  withThrowingLocalStorage(() => {
    expect(loadSidebarCollapsed()).toBe(false);
    expect(() => saveSidebarCollapsed(true)).not.toThrow();
  });
});
