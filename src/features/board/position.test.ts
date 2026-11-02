import { beforeEach, expect, test } from 'vitest';

import { BOARD_POSITION_PREFIX, loadBoardPosition, saveBoardPosition } from './position';

beforeEach(() => {
  sessionStorage.clear();
});

test('saves and restores per-column offsets and the focused card', () => {
  saveBoardPosition('p1', { focusedId: 'bza-2', scroll: { ready: 320, done: 64 } });

  expect(loadBoardPosition('p1')).toEqual({
    focusedId: 'bza-2',
    scroll: { ready: 320, done: 64 },
  });
});

test('a missing or malformed entry means start at the top', () => {
  expect(loadBoardPosition('missing')).toBeNull();

  sessionStorage.setItem(`${BOARD_POSITION_PREFIX}p1`, '{not json');
  expect(loadBoardPosition('p1')).toBeNull();

  sessionStorage.setItem(
    `${BOARD_POSITION_PREFIX}p1`,
    JSON.stringify({ focusedId: 3, scroll: {} })
  );
  expect(loadBoardPosition('p1')).toBeNull();
});

test('rejects negative or non-finite offsets rather than restoring a broken scroll', () => {
  sessionStorage.setItem(
    `${BOARD_POSITION_PREFIX}p1`,
    JSON.stringify({ focusedId: null, scroll: { ready: -1 } })
  );
  expect(loadBoardPosition('p1')).toBeNull();

  sessionStorage.setItem(
    `${BOARD_POSITION_PREFIX}p1`,
    JSON.stringify({ focusedId: null, scroll: { ready: Number.POSITIVE_INFINITY } })
  );
  expect(loadBoardPosition('p1')).toBeNull();
});

test('missing focusedId is allowed; unknown columns are kept as offsets', () => {
  sessionStorage.setItem(
    `${BOARD_POSITION_PREFIX}p1`,
    JSON.stringify({ scroll: { 'in-progress': 12 } })
  );
  expect(loadBoardPosition('p1')).toEqual({
    focusedId: null,
    scroll: { 'in-progress': 12 },
  });
});

test('a storage failure is swallowed', () => {
  const broken: Storage = {
    get length() {
      return 0;
    },
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

  expect(loadBoardPosition('p1', broken)).toBeNull();
  expect(() => saveBoardPosition('p1', { focusedId: null, scroll: {} }, broken)).not.toThrow();
});
