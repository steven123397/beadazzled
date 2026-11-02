import type { BoardCard, BoardColumn, ColumnId } from './columns';

export type FocusKey = 'h' | 'l' | 'j' | 'k';

export type FocusPosition = { columnIndex: number; cardIndex: number };

/**
 * Locates the focused card in the rendered board. Columns can be empty and
 * filtered, so this is recomputed from the current model rather than stored.
 */
export function findFocus(
  columns: readonly BoardColumn[],
  issueId: string | null
): FocusPosition | null {
  if (issueId === null) {
    return null;
  }
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const cardIndex = columns[columnIndex].cards.findIndex((card) => card.issue.id === issueId);
    if (cardIndex !== -1) {
      return { columnIndex, cardIndex };
    }
  }
  return null;
}

/** The card currently under focus, or null when focus is stale. */
export function focusedCard(
  columns: readonly BoardColumn[],
  issueId: string | null
): { columnId: ColumnId; card: BoardCard } | null {
  const position = findFocus(columns, issueId);
  if (position === null) {
    return null;
  }
  const column = columns[position.columnIndex];
  const card = column?.cards[position.cardIndex];
  return column === undefined || card === undefined ? null : { columnId: column.id, card };
}

/**
 * H/L move between columns, J/K within one. Empty columns are skipped when
 * moving sideways so focus never lands on nothing; vertical movement clamps at
 * the ends, matching the list.
 */
export function moveFocus(
  columns: readonly BoardColumn[],
  issueId: string | null,
  key: FocusKey
): string | null {
  const position = findFocus(columns, issueId);
  if (position === null) {
    return firstCardId(columns);
  }

  if (key === 'j' || key === 'k') {
    const cards = columns[position.columnIndex]?.cards ?? [];
    const next = clamp(position.cardIndex + (key === 'j' ? 1 : -1), 0, cards.length - 1);
    return cards[next]?.issue.id ?? null;
  }

  const step = key === 'l' ? 1 : -1;
  for (
    let columnIndex = position.columnIndex + step;
    columnIndex >= 0 && columnIndex < columns.length;
    columnIndex += step
  ) {
    const cards = columns[columnIndex]?.cards ?? [];
    if (cards.length === 0) {
      continue;
    }
    const cardIndex = Math.min(position.cardIndex, cards.length - 1);
    return cards[cardIndex]?.issue.id ?? null;
  }
  return null;
}

export function firstCardId(columns: readonly BoardColumn[]): string | null {
  for (const column of columns) {
    const first = column.cards[0];
    if (first !== undefined) {
      return first.issue.id;
    }
  }
  return null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
