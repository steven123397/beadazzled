import { expect, test } from 'vitest';

import type { Issue } from '@/bindings/bd';

import type { BoardCard, BoardColumn } from './columns';
import { findFocus, firstCardId, focusedCard, moveFocus } from './keyboard';

const TS = '2026-11-01T00:00:00Z';

function issue(id: string): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: TS,
    updated_at: TS,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
  };
}

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
