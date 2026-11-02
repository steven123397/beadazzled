import { expect, test } from 'vitest';

import { LIST_POSITION_PREFIX, loadListPosition, saveListPosition } from './position';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test('a saved position round trips for its workspace', () => {
  const storage = memoryStorage();

  saveListPosition('p1', { scrollTop: 180, focusedId: 'bza-3' }, storage);

  expect(loadListPosition('p1', storage)).toEqual({ scrollTop: 180, focusedId: 'bza-3' });
  expect(loadListPosition('p2', storage)).toBeNull();
  expect(storage.getItem(`${LIST_POSITION_PREFIX}p1`)).toContain('bza-3');
});

test('a missing or malformed stored position is ignored', () => {
  const storage = memoryStorage();

  expect(loadListPosition('p1', storage)).toBeNull();

  storage.setItem(`${LIST_POSITION_PREFIX}p1`, '{not json');
  expect(loadListPosition('p1', storage)).toBeNull();

  storage.setItem(`${LIST_POSITION_PREFIX}p1`, JSON.stringify({ scrollTop: -1, focusedId: null }));
  expect(loadListPosition('p1', storage)).toBeNull();

  storage.setItem(`${LIST_POSITION_PREFIX}p1`, JSON.stringify({ scrollTop: 10, focusedId: 4 }));
  expect(loadListPosition('p1', storage)).toBeNull();
});

test('storage failures never break the list', () => {
  const broken: Storage = {
    length: 0,
    clear() {},
    getItem() {
      throw new Error('blocked');
    },
    key() {
      return null;
    },
    removeItem() {},
    setItem() {
      throw new Error('blocked');
    },
  };

  expect(loadListPosition('p1', broken)).toBeNull();
  expect(() => saveListPosition('p1', { scrollTop: 1, focusedId: null }, broken)).not.toThrow();
});
