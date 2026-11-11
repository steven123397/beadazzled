import { expect, test } from 'vitest';

import { makeIssue as issue } from '@/test/fixtures';

import type { BoardCard, BoardColumn } from './columns';
import { findFocus, firstCardId, focusedCard, moveFocus } from './keyboard';

function card(id: string): BoardCard {
  return { issue: issue(id), blockers: [], manual: false };
}

function column(id: BoardColumn['id'], ids: string[]): BoardColumn {
  return { id, cards: ids.map(card) };
}

const columns: BoardColumn[] = [
  column('backlog', []),
  column('ready', ['bza-1', 'bza-2']),
  column('in-progress', ['bza-3']),
  column('blocked', ['bza-4']),
  column('done', []),
  column('other', ['bza-5']),
];

test('findFocus and focusedCard resolve the current card and column', () => {
  expect(findFocus(columns, 'bza-3')).toEqual({ columnIndex: 2, cardIndex: 0 });
  expect(findFocus(columns, 'missing')).toBeNull();
  expect(findFocus(columns, null)).toBeNull();
  expect(focusedCard(columns, 'bza-4')).toEqual({
    columnId: 'blocked',
    card: columns[3]?.cards[0],
  });
});

test('J and K move within a column and clamp at the ends', () => {
  expect(moveFocus(columns, 'bza-1', 'j')).toBe('bza-2');
  expect(moveFocus(columns, 'bza-2', 'j')).toBe('bza-2');
  expect(moveFocus(columns, 'bza-1', 'k')).toBe('bza-1');
  expect(moveFocus(columns, 'bza-2', 'k')).toBe('bza-1');
});

test('H and L skip empty columns', () => {
  // Ready -> In Progress directly; the empty Backlog is skipped, and there is
  // no column left of Ready.
  expect(moveFocus(columns, 'bza-1', 'h')).toBeNull();
  expect(moveFocus(columns, 'bza-1', 'l')).toBe('bza-3');
  // In Progress -> Blocked (Done is empty); focus is allowed to inspect it.
  expect(moveFocus(columns, 'bza-3', 'l')).toBe('bza-4');
  // Blocked -> Other.
  expect(moveFocus(columns, 'bza-4', 'l')).toBe('bza-5');
  // Other -> Blocked on the way back; Done is still empty.
  expect(moveFocus(columns, 'bza-5', 'h')).toBe('bza-4');
});

test('sideways movement keeps the card index and clamps it', () => {
  expect(moveFocus(columns, 'bza-2', 'l')).toBe('bza-3');
  expect(moveFocus(columns, 'bza-3', 'h')).toBe('bza-1');
});

test('with no focus, the first card of the first non-empty column wins', () => {
  expect(firstCardId(columns)).toBe('bza-1');
  expect(moveFocus(columns, null, 'j')).toBe('bza-1');
});

test('resolves focus using lookup map and falls back gracefully', () => {
  const lookup = new Map([
    ['bza-1', { columnIndex: 1, cardIndex: 0 }],
    ['bza-2', { columnIndex: 1, cardIndex: 1 }],
    ['bza-3', { columnIndex: 2, cardIndex: 0 }],
  ]);

  expect(findFocus(columns, 'bza-2', lookup)).toEqual({ columnIndex: 1, cardIndex: 1 });
  expect(moveFocus(columns, 'bza-1', 'j', lookup)).toBe('bza-2');
  expect(moveFocus(columns, 'bza-1', 'l', lookup)).toBe('bza-3');
  // Stale/missing lookup entry falls back to linear search
  expect(findFocus(columns, 'bza-4', lookup)).toEqual({ columnIndex: 3, cardIndex: 0 });
});

