import { expect, test } from 'vitest';

import { LIST_VIEW_PREFIX, loadSavedView, saveSavedView } from './view-storage';
import { createListViewState } from './view-state';

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

test('a saved view round trips for its workspace', () => {
  const storage = memoryStorage();
  const view = createListViewState();
  view.filter.query = 'scroll';
  view.filter.status = ['open'];
  view.group = 'status';
  view.sort = { by: 'priority', direction: 'asc' };

  saveSavedView('p1', view, storage);

  expect(loadSavedView('p1', storage)).toEqual(view);
  expect(loadSavedView('p2', storage)).toBeNull();
  expect(storage.getItem(`${LIST_VIEW_PREFIX}p1`)).toContain('scroll');
});

test('a missing or malformed saved view falls back to no preference', () => {
  const storage = memoryStorage();

  expect(loadSavedView('p1', storage)).toBeNull();

  storage.setItem(`${LIST_VIEW_PREFIX}p1`, '{not json');
  expect(loadSavedView('p1', storage)).toBeNull();

  storage.setItem(
    `${LIST_VIEW_PREFIX}p1`,
    JSON.stringify({ filter: { query: 'x', status: 'open' } })
  );
  expect(loadSavedView('p1', storage)).toBeNull();
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

  expect(loadSavedView('p1', broken)).toBeNull();
  expect(() => saveSavedView('p1', createListViewState(), broken)).not.toThrow();
});
