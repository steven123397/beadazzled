import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { Card, cardId } from './Card';
import { COLUMN_LABEL_KEYS, type BoardColumn, type ColumnId } from './columns';
import { isDroppableColumn } from './move';

/** Must match `--card-height` in tokens.css. */
export const CARD_HEIGHT = 120;
const CARD_GAP = 8;
const OVERSCAN = 4;
const INITIAL_RECT = { width: 288, height: 600 };

export type ColumnProps = {
  column: BoardColumn;
  focusedId: string | null;
  /** Bumped by keyboard navigation; avoids stealing focus on filter changes. */
  focusRequest: number;
  /** Scroll offset restored when the board returns from the detail route. */
  initialScrollTop?: number;
  /** Reports the column's offset so the board can persist it on unmount. */
  onScrollTop?: (columnId: ColumnId, scrollTop: number) => void;
  isPending: (issueId: string) => boolean;
  onOpen: (issue: Issue) => void;
  onFocus: (id: string) => void;
};

/**
 * One column with its own virtualizer: a 250-card Done column must not mount
 * every card just because another column is short. Columns scroll
 * independently and keep a fixed order.
 */
export function Column({
  column,
  focusedId,
  focusRequest,
  initialScrollTop,
  onScrollTop,
  isPending,
  onOpen,
  onFocus,
}: ColumnProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const label = t(COLUMN_LABEL_KEYS[column.id]);
  const accepts = isDroppableColumn(column.id);
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: column.id,
    data: { accepts },
  });

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => CARD_HEIGHT + CARD_GAP, []);
  const getItemKey = useCallback(
    (index: number) => column.cards[index]?.issue.id ?? index,
    [column.cards]
  );

  const virtualizer = useVirtualizer({
    count: column.cards.length,
    getScrollElement,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
    initialRect: INITIAL_RECT,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Restore the offset captured before the board unmounted. An empty column
  // renders no scroll container, so wait until one exists before giving up.
  const restoredRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredRef.current) {
      return;
    }
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    restoredRef.current = true;
    if (initialScrollTop === undefined || initialScrollTop <= 0) {
      return;
    }
    element.scrollTop = initialScrollTop;
    virtualizer.scrollToOffset(initialScrollTop);
    onScrollTop?.(column.id, initialScrollTop);
  }, [column.cards.length, column.id, initialScrollTop, onScrollTop, virtualizer]);

  // Only an explicit keyboard focus request scrolls and focuses; a filter
  // change must not pull focus out of the search box.
  const pendingFocusRef = useRef<string | null>(null);
  const handledRequestRef = useRef(0);
  useEffect(() => {
    if (focusRequest === handledRequestRef.current) {
      return;
    }
    handledRequestRef.current = focusRequest;
    if (focusedId === null) {
      return;
    }
    const index = column.cards.findIndex((card) => card.issue.id === focusedId);
    if (index === -1) {
      return;
    }
    pendingFocusRef.current = focusedId;
    virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [column.cards, focusRequest, focusedId, virtualizer]);

  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id === null) {
      return;
    }
    const element = document.getElementById(cardId(id));
    if (element === null) {
      return;
    }
    pendingFocusRef.current = null;
    element.focus({ preventScroll: true });
  }, [focusedId, virtualItems]);

  return (
    <section
      ref={setDropRef}
      data-column-id={column.id}
      aria-label={label}
      className={`flex h-full min-h-0 w-72 shrink-0 flex-col rounded-md border bg-muted/30 ${
        isOver
          ? accepts
            ? 'border-ring ring-2 ring-ring/40'
            : 'border-destructive/50'
          : 'border-border'
      }`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <h2 className="text-xs font-semibold">{label}</h2>
        <span className="text-2xs tabular-nums text-muted-foreground">{column.cards.length}</span>
      </header>

      {column.cards.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-3 text-xs text-muted-foreground">
          {t('board.column.empty')}
        </p>
      ) : (
        <div
          ref={scrollRef}
          role="list"
          aria-label={label}
          onScroll={(event) => onScrollTop?.(column.id, event.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-auto p-1.5"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((item) => {
              const card = column.cards[item.index];
              if (card === undefined) {
                return null;
              }
              return (
                <Card
                  key={item.key}
                  card={card}
                  column={column.id}
                  start={item.start}
                  focused={card.issue.id === focusedId}
                  pending={isPending(card.issue.id)}
                  onOpen={onOpen}
                  onFocus={onFocus}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
