import {
  memo,
  useMemo,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';

import type { Issue } from '@/bindings/bd';
import { Badge } from '@/components/ui/badge';
import { PriorityIcon } from '@/components/ui/priority-icon';
import { useI18n } from '@/lib/i18n/I18nProvider';

import type { BoardCard, ColumnId } from './columns';

export type CardProps = {
  card: BoardCard;
  /** Derived column the card currently renders in. */
  column: ColumnId;
  /** Vertical offset in the virtual column, in pixels. */
  start: number;
  focused: boolean;
  /** The card's write is in flight; it cannot be dragged again yet. */
  pending?: boolean;
  onOpen: (issue: Issue) => void;
  onFocus: (id: string) => void;
};

export function cardId(issueId: string): string {
  return `board-card-${issueId}`;
}

/**
 * The card's content without drag wiring. The drag overlay reuses this so a
 * dragged card looks identical to the one in the column.
 */
export function CardBody({
  card,
  focused = false,
  pending = false,
  dragHandle,
}: {
  card: BoardCard;
  focused?: boolean;
  pending?: boolean;
  dragHandle?: ReactNode;
}) {
  const { t } = useI18n();
  const { issue, blockers, manual } = card;
  const visibleLabels = issue.labels.slice(0, 2);
  const extraLabels = issue.labels.length - visibleLabels.length;
  const moreLabels = useMemo(
    () => (extraLabels > 0 ? t('list.moreLabels', { count: extraLabels }) : ''),
    [extraLabels, t]
  );
  const blockedIds = blockers.join(', ');
  const blockedLabel = t('board.card.blockedBy', { count: blockers.length });
  // Secondary text sits on `--selected` while focused; the muted tone only
  // reaches 4.1:1 there at 11px, below the 4.5:1 floor for small text.
  const secondary = focused ? 'text-selected-foreground' : 'text-muted-foreground';
  const blockedTone = focused ? 'text-selected-foreground' : 'text-destructive';

  return (
    <>
      <div className={`flex items-center gap-1.5 text-2xs ${secondary}`}>
        <PriorityIcon priority={issue.priority} />
        <span className="tabular-nums">P{issue.priority}</span>
        <span className="truncate font-mono">{issue.id}</span>
        {pending ? (
          <span role="status" className="ml-auto shrink-0">
            {t('board.card.saving')}
          </span>
        ) : null}
        {dragHandle}
      </div>

      <p className="mt-1 line-clamp-3 leading-snug" title={issue.title}>
        {issue.title}
      </p>

      <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
        {visibleLabels.map((label, index) => (
          <Badge key={`${label}-${index}`} className="min-w-0 truncate">
            {label}
          </Badge>
        ))}
        {extraLabels > 0 ? (
          <span className={`shrink-0 text-2xs ${secondary}`}>{moreLabels}</span>
        ) : null}
        <span
          className={`ml-auto shrink-0 truncate text-2xs ${secondary} ${
            issue.assignee === undefined ? 'italic' : ''
          }`}
        >
          {issue.assignee ?? t('list.unassigned')}
        </span>
      </div>

      {manual || blockers.length > 0 ? (
        <p
          className={`mt-1 flex items-center gap-1 overflow-hidden text-2xs ${blockedTone}`}
          title={blockedIds}
        >
          {blockers.length > 0 ? (
            <>
              <span className="shrink-0 font-medium">{blockedLabel}</span>
              <span className="truncate font-mono">{blockedIds}</span>
            </>
          ) : null}
          <span
            className={`ml-auto shrink-0 rounded-sm border px-1 ${
              focused ? 'border-selected-foreground/30' : 'border-destructive/30'
            }`}
          >
            {manual ? t('board.card.manualBlocked') : t('board.card.dependencyBlocked')}
          </span>
        </p>
      ) : null}
    </>
  );
}

/**
 * One board card. Memoized and given identity-stable props: scrolling one
 * column must not reconcile the cards in the others.
 *
 * Pointer dragging starts anywhere on the card; the small grip is the keyboard
 * activator, so Enter on the card itself still opens the detail page.
 */
export const Card = memo(function Card({
  card,
  column,
  start,
  focused,
  pending = false,
  onOpen,
  onFocus,
}: CardProps) {
  const { t } = useI18n();
  const { issue } = card;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: issue.id,
    disabled: pending,
    data: { issueId: issue.id, columnId: column },
  });

  return (
    <div
      ref={setNodeRef}
      id={cardId(issue.id)}
      role="listitem"
      aria-current={focused ? 'true' : undefined}
      data-issue-id={issue.id}
      data-card-column={column}
      data-focused={focused ? 'true' : 'false'}
      data-pending={pending ? 'true' : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      tabIndex={focused ? 0 : -1}
      onClick={() => onOpen(issue)}
      onFocus={() => onFocus(issue.id)}
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLDivElement> | undefined}
      className={`absolute left-0 w-full cursor-grab overflow-hidden rounded-md border bg-card p-2 text-xs shadow-xs transition-colors ${
        focused
          ? 'border-ring bg-selected text-selected-foreground'
          : 'border-border hover:bg-hover'
      } ${pending ? 'opacity-70' : ''} ${isDragging ? 'opacity-30' : ''}`}
      // Position with `top` rather than a translate: dnd-kit measures the
      // draggable rect with transforms ignored, and a translate would make it
      // think every virtualized card sits at the top of its column.
      style={{ height: 'var(--card-height)', top: start }}
    >
      <CardBody
        card={card}
        focused={focused}
        pending={pending}
        dragHandle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            aria-label={t('board.card.drag', { id: issue.id })}
            onKeyDown={listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
            onClick={(event) => event.stopPropagation()}
            className="ml-auto shrink-0 cursor-grab rounded-sm p-0.5 text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <GripVertical aria-hidden="true" className="size-3" />
          </button>
        }
      />
    </div>
  );
});
