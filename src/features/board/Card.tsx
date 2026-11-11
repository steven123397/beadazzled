import { memo, type KeyboardEventHandler, type PointerEventHandler, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Ban, GripVertical } from 'lucide-react';

import type { Issue } from '@/bindings/bd';
import { LabelChips } from '@/components/label-chips';
import { PriorityIcon } from '@/components/ui/priority-icon';
import { Tooltip } from '@/components/ui/tooltip';
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
  const blockedIds = blockers.join(', ');
  const blockedBy =
    blockers.length > 0 ? t('board.card.blockedBy', { count: blockers.length }) : '';
  const blockedLabel = blockers.length > 0 ? blockedBy : t('board.card.manualBlocked');
  // A card can be blocked by hand and by dependencies at once. The chip stays
  // compact, but the full cause and the blocker ids go in a focusable hint.
  const blockedDetail =
    blockedIds === ''
      ? ''
      : manual
        ? `${t('board.card.manualBlocked')} · ${blockedBy}: ${blockedIds}`
        : `${blockedBy}: ${blockedIds}`;
  const blocked = manual || blockers.length > 0;
  const chipClass = `flex min-w-0 shrink-0 items-center gap-0.5 rounded-sm px-1 ${
    focused ? 'bg-selected-foreground/10 text-selected-foreground' : 'bg-warning/12 text-warning'
  }`;
  // Secondary text sits on `--selected` while focused; the muted tone only
  // reaches 4.1:1 there at 11px, below the 4.5:1 floor for small text.
  const secondary = focused ? 'text-selected-foreground' : 'text-muted-foreground';

  return (
    <>
      <div className={`flex items-center gap-1.5 text-2xs ${secondary}`}>
        <PriorityIcon priority={issue.priority} />
        <span className="tabular-nums">P{issue.priority}</span>
        <span className="min-w-0 truncate font-mono">{issue.id}</span>
        {blocked ? (
          blockedDetail === '' ? (
            <span className={chipClass}>
              <Ban aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{blockedLabel}</span>
            </span>
          ) : (
            <Tooltip label={blockedDetail} className="min-w-0 shrink-0">
              <span
                // The board uses a roving tabindex, so the chip joins the tab
                // order only while its card is the focused one.
                tabIndex={focused ? 0 : -1}
                aria-label={blockedDetail}
                className={chipClass}
              >
                <Ban aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{blockedLabel}</span>
              </span>
            </Tooltip>
          )
        ) : null}
        <span className="ml-auto" />
        {pending ? (
          <span role="status" className="shrink-0">
            {t('board.card.saving')}
          </span>
        ) : null}
        {dragHandle}
      </div>

      <p className="mt-1 line-clamp-3 text-sm font-medium leading-snug" title={issue.title}>
        {issue.title}
      </p>

      <div className="mt-auto flex items-center gap-1 overflow-hidden pt-1.5">
        <LabelChips
          labels={issue.labels}
          badgeClassName="truncate"
          extraClassName={`text-2xs ${secondary}`}
        />
        <span
          className={`ml-auto shrink-0 truncate text-2xs ${secondary} ${
            issue.assignee === undefined ? 'italic' : ''
          }`}
        >
          {issue.assignee ?? t('list.unassigned')}
        </span>
      </div>
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
      className={`absolute left-0 flex w-full cursor-grab flex-col overflow-hidden rounded-md border bg-raised p-2 text-xs shadow-xs transition-colors ${
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
            className="ml-auto shrink-0 cursor-grab rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
          >
            <GripVertical aria-hidden="true" className="size-3" />
          </button>
        }
      />
    </div>
  );
});
