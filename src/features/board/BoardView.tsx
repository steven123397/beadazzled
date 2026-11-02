import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import type { Issue, SyncState } from '@/bindings/bd';
import { isEditableTarget, isOverlayOpen } from '@/app/keyboard/resolve';
import { FilterBar } from '@/components/filter-bar';
import { describeError } from '@/lib/errors';
import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { indexIssues } from '@/lib/store/selectors';
import { buildSearchIndex } from '@/lib/view/filter';
import {
  createListViewState,
  hasViewParams,
  parseListViewState,
  serializeListViewState,
  type ListViewState,
} from '@/lib/view/state';
import { loadSavedView, saveSavedView } from '@/lib/view/storage';
import type { UseWrite } from '@/lib/writes/useWrite';

import { Column } from './Column';
import {
  buildBoard,
  COLUMN_LABEL_KEYS,
  filterForBoard,
  hasBoardFilters,
  type BoardCard,
  type ColumnId,
} from './columns';
import { BoardDragOverlay } from './DragOverlay';
import { firstCardId, focusedCard, moveFocus, type FocusKey } from './keyboard';
import { adjacentDroppableColumn, planMove, type MoveRejection } from './move';
import { loadBoardPosition, saveBoardPosition } from './position';

const HEALTHY: SyncState = { kind: 'healthy', lastSeq: 0, lastEventAt: null };

type BoardState = 'loading' | 'empty' | 'bd-unavailable' | 'ready';

type Notice = { tone: 'info' | 'error'; text: string };

type DragState = { id: string; column: ColumnId };

export type BoardViewProps = {
  projectId: string;
  issues: readonly Issue[];
  syncState?: SyncState;
  onRefresh?: () => void;
  /** Injected by the app; absent in unit/e2e setups without a write flow. */
  writes?: UseWrite;
};

export type BoardRouteProps = {
  issues: readonly Issue[];
  syncState?: SyncState;
  onRefresh?: () => void;
  writes?: UseWrite;
};

/** Reads the route param and remounts the board when the workspace changes. */
export function BoardRoute({ issues, syncState, onRefresh, writes }: BoardRouteProps) {
  const { projectId = '' } = useParams<{ projectId: string }>();
  return (
    <BoardView
      key={projectId}
      projectId={projectId}
      issues={issues}
      syncState={syncState}
      onRefresh={onRefresh}
      writes={writes}
    />
  );
}

export function BoardView({
  projectId,
  issues,
  syncState = HEALTHY,
  onRefresh,
  writes,
}: BoardViewProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const hasParams = useMemo(() => hasViewParams(new URLSearchParams(search)), [search]);
  const savedView = useMemo(() => loadSavedView(projectId), [projectId]);
  // Grouping and sorting are list-only; read the stored view once per mount
  // instead of on every filter keystroke.
  const storedView = useMemo(() => savedView ?? createListViewState(), [savedView]);
  const latestViewRef = useRef<ListViewState | null>(null);

  // Board and list share one filter state. The URL wins; without view params
  // the view the user last used is kept, exactly like the list.
  const view = useMemo(() => {
    if (hasParams) {
      return parseListViewState(new URLSearchParams(search));
    }
    return latestViewRef.current ?? savedView ?? createListViewState();
  }, [hasParams, savedView, search]);

  useEffect(() => {
    latestViewRef.current = view;
    // Keep the list's grouping and sorting: the board never changes them, and
    // switching back to the list must not reset the user's choice.
    saveSavedView(projectId, { ...storedView, filter: view.filter });
  }, [projectId, storedView, view]);

  // Mirror a saved filter into the URL when the board is opened without
  // parameters. Grouping and sorting are list-only and stay out of a board URL.
  useEffect(() => {
    if (hasParams) {
      return;
    }
    const next = serializeBoardView(view, new URLSearchParams(search));
    if (next.toString() !== '' && next.toString() !== search) {
      setSearchParams(next, { replace: true });
    }
  }, [hasParams, search, setSearchParams, view]);

  const updateView = useCallback(
    (next: ListViewState) => {
      latestViewRef.current = next;
      setSearchParams((previous) => serializeBoardView(next, previous), { replace: true });
    },
    [setSearchParams]
  );

  const index = useMemo(() => indexIssues(issues), [issues]);
  const searchText = useMemo(() => buildSearchIndex(issues), [issues]);
  const visible = useMemo(
    () =>
      filterForBoard(issues, view.filter, {
        searchText,
        issuesById: index.byId,
      }),
    [index.byId, issues, searchText, view.filter]
  );
  const board = useMemo(() => buildBoard(visible, index.byId), [index.byId, visible]);
  const activeFilters = hasBoardFilters(view.filter);

  // Lookup built once per board model so keyboard navigation, drag start and
  // the overlay all agree on where a card is.
  const layout = useMemo(() => {
    const cards = new Map<string, BoardCard>();
    const positions = new Map<string, { columnId: ColumnId }>();
    for (const column of board.columns) {
      for (const card of column.cards) {
        cards.set(card.issue.id, card);
        positions.set(card.issue.id, { columnId: column.id });
      }
    }
    return { cards, positions };
  }, [board]);

  // Position from the previous visit: the detail route unmounts the board, so
  // scroll offsets and the focused card have to come back from storage.
  const initialPosition = useMemo(() => loadBoardPosition(projectId), [projectId]);

  const [focusedId, setFocusedId] = useState<string | null>(initialPosition?.focusedId ?? null);
  const [focusRequest, setFocusRequest] = useState(initialPosition?.focusedId ? 1 : 0);
  const [activeDrag, setActiveDrag] = useState<DragState | null>(null);
  const [movingIds, setMovingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<Notice | null>(null);

  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const scrollTops = useRef<Record<string, number>>(initialPosition?.scroll ?? {});
  const onScrollTop = useCallback((columnId: ColumnId, scrollTop: number) => {
    scrollTops.current[columnId] = scrollTop;
  }, []);

  // Written in a layout cleanup, before the columns are detached. Reading the
  // DOM at that point would see the container already gone.
  useLayoutEffect(
    () => () =>
      saveBoardPosition(projectId, {
        focusedId: focusedIdRef.current,
        scroll: scrollTops.current,
      }),
    [projectId]
  );

  // Keep exactly one card tabbable, and drop a ghost id: a focused card that
  // was filtered out, closed elsewhere or restored from an earlier visit would
  // otherwise leave every card at tabIndex -1 and make Tab skip the board.
  useEffect(() => {
    if (focusedId !== null && layout.cards.has(focusedId)) {
      return;
    }
    const first = firstCardId(board.columns);
    if (first !== focusedId) {
      setFocusedId(first);
    }
  }, [board.columns, focusedId, layout]);

  const requestFocus = useCallback((id: string) => {
    setFocusedId(id);
    setFocusRequest((value) => value + 1);
  }, []);

  const isPending = useCallback(
    (issueId: string) => movingIds.has(issueId) || (writes?.isPending(issueId) ?? false),
    [movingIds, writes]
  );

  const openIssue = useCallback(
    (issue: Issue) => {
      navigate(`/w/${projectId}/issue/${encodeURIComponent(issue.id)}`);
    },
    [navigate, projectId]
  );

  const clearFilters = useCallback(() => {
    // The board hides the status control but the URL keeps it for the list
    // (SPEC-board "状态筛选在看板隐藏"); clearing must not silently drop it.
    updateView({
      ...view,
      filter: { ...createListViewState().filter, status: view.filter.status },
    });
  }, [updateView, view]);

  const attemptMove = useCallback(
    (card: BoardCard, source: ColumnId, target: ColumnId, origin: 'drag' | 'keyboard') => {
      const issue = card.issue;
      if (movingIds.has(issue.id) || (writes?.isPending(issue.id) ?? false)) {
        return;
      }

      const plan = planMove(issue, source, target, card.blockers);
      if (!plan.ok) {
        if (plan.rejection.reason === 'same-column') {
          return;
        }
        setNotice({ tone: 'error', text: rejectionText(plan.rejection, t) });
        return;
      }
      if (writes === undefined) {
        setNotice({ tone: 'error', text: t('board.move.writeUnavailable') });
        return;
      }

      writes.clearError();
      setMovingIds((previous) => new Set(previous).add(issue.id));
      setNotice({ tone: 'info', text: t('board.move.pending', { id: issue.id }) });

      void (async () => {
        let failure: string | null = null;
        try {
          for (const [position, command] of plan.commands.entries()) {
            const outcome = await writes.submit({
              key: `board:${issue.id}:${target}:${position}`,
              issueId: issue.id,
              build: () => command,
            });
            if (outcome.status !== 'ok') {
              failure = describeError(outcome.error).message;
              break;
            }
            // A write can succeed and still miss its journal echo. Do not
            // announce the move or continue a two-command sequence as if the
            // store already reflected the first one.
            if (outcome.echo !== 'echoed') {
              failure = t('board.move.unconfirmed', { id: issue.id });
              break;
            }
          }
        } catch (error) {
          // `submit` reports failures as results; a rejection here would leave
          // the card pending forever without this guard.
          failure = error instanceof Error ? error.message : String(error);
        } finally {
          setMovingIds((previous) => {
            const next = new Set(previous);
            next.delete(issue.id);
            return next;
          });
        }
        setNotice(
          failure === null
            ? {
                tone: 'info',
                text: t('board.move.moved', { id: issue.id, column: t(COLUMN_LABEL_KEYS[target]) }),
              }
            : { tone: 'error', text: failure }
        );
        if (failure === null && origin === 'keyboard') {
          requestFocus(issue.id);
        }
      })();
    },
    [movingIds, requestFocus, t, writes]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  // A pointer is the precise signal; keyboard drags have no pointer, so fall
  // back to the nearest column rectangle.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    return pointer.length > 0 ? pointer : closestCorners(args);
  }, []);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      const position = layout.positions.get(id);
      if (position === undefined) {
        return;
      }
      setActiveDrag({ id, column: position.columnId });
      setFocusedId(id);
    },
    [layout]
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      if (event.over === null) {
        return;
      }
      const id = String(event.active.id);
      const card = layout.cards.get(id);
      const source = layout.positions.get(id)?.columnId;
      if (card === undefined || source === undefined) {
        return;
      }
      attemptMove(card, source, String(event.over.id) as ColumnId, 'drag');
    },
    [attemptMove, layout]
  );

  const onDragCancel = useCallback(() => setActiveDrag(null), []);

  // Keyboard navigation and moves. While a dnd-kit keyboard drag is active,
  // its own sensor owns the arrow keys.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (isEditableTarget(event.target) || isOverlayOpen() || activeDrag !== null) {
        return;
      }

      if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        // A move is a write: only start one when focus is on the board itself,
        // not on a filter control or the sidebar.
        if (!isBoardTarget(event.target)) {
          return;
        }
        const current = focusedCard(board.columns, focusedId);
        if (current === null) {
          return;
        }
        event.preventDefault();
        // Blocked has no adjacent droppable column; say why instead of the
        // generic edge message.
        if (current.columnId === 'blocked') {
          setNotice({ tone: 'error', text: t('board.move.blockedColumn') });
          return;
        }
        const target = adjacentDroppableColumn(
          current.columnId,
          event.key === 'ArrowLeft' ? 'left' : 'right'
        );
        if (target === null) {
          setNotice({ tone: 'error', text: t('board.move.noColumn') });
          return;
        }
        attemptMove(current.card, current.columnId, target, 'keyboard');
        return;
      }

      if (event.key === 'Enter') {
        const current = focusedCard(board.columns, focusedId);
        if (current !== null && isBoardTarget(event.target)) {
          event.preventDefault();
          openIssue(current.card.issue);
        }
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== 'h' && key !== 'l' && key !== 'j' && key !== 'k') {
        return;
      }
      event.preventDefault();
      const next = moveFocus(board.columns, focusedId, key as FocusKey);
      if (next !== null) {
        requestFocus(next);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDrag, attemptMove, board.columns, focusedId, openIssue, requestFocus, t]);

  const total = issues.length;
  const state: BoardState =
    syncState.kind === 'loading' && total === 0
      ? 'loading'
      : syncState.kind === 'bd-unavailable' && total === 0
        ? 'bd-unavailable'
        : total === 0
          ? 'empty'
          : 'ready';

  return (
    <section
      data-testid="board-view"
      data-state={state}
      data-sync={syncState.kind}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <h1 className="text-sm font-semibold">{t('nav.board')}</h1>
      </header>

      {total > 0 ? (
        <FilterBar
          view={view}
          issues={issues}
          visibleCount={visible.length}
          totalCount={total}
          onChange={updateView}
          onClear={clearFilters}
          mode="board"
          activeFilters={activeFilters}
        />
      ) : null}

      {syncState.kind === 'bd-unavailable' && total > 0 ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1">{t('list.state.stale')}</span>
          {onRefresh === undefined ? null : (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded border border-destructive/40 px-2 py-1"
            >
              {t('list.state.retry')}
            </button>
          )}
        </div>
      ) : null}

      {notice === null ? null : (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
          className={`shrink-0 border-b px-3 py-1.5 text-xs ${
            notice.tone === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-border bg-muted/40 text-muted-foreground'
          }`}
        >
          {notice.text}
        </div>
      )}

      {state === 'loading' ? (
        <LoadingBoard />
      ) : state === 'empty' ? (
        <EmptyState />
      ) : state === 'bd-unavailable' ? (
        <ErrorState
          message={syncState.kind === 'bd-unavailable' ? syncState.error.message : ''}
          onRefresh={onRefresh}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
            {board.columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                focusedId={focusedId}
                focusRequest={focusRequest}
                initialScrollTop={initialPosition?.scroll[column.id]}
                onScrollTop={onScrollTop}
                isPending={isPending}
                onOpen={openIssue}
                onFocus={setFocusedId}
              />
            ))}
          </div>
          <BoardDragOverlay
            card={activeDrag === null ? null : (layout.cards.get(activeDrag.id) ?? null)}
          />
        </DndContext>
      )}
    </section>
  );
}

/** Writes the shared filter; list-only grouping and sorting are left out. */
function serializeBoardView(
  view: ListViewState,
  params: URLSearchParams = new URLSearchParams()
): URLSearchParams {
  const next = serializeListViewState(view, params);
  next.delete('group');
  next.delete('sort');
  return next;
}

function rejectionText(
  rejection: MoveRejection,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
): string {
  switch (rejection.reason) {
    case 'same-column':
      return '';
    case 'source-blocked':
      return t('board.move.blockedColumn');
    case 'target-not-droppable':
      return t('board.move.notDroppable');
    case 'ready-blocked':
      return t('board.move.readyBlocked', { ids: rejection.blockers.join(', ') });
    case 'blocked-by-dependencies':
      return t('detail.edit.blockedByDependencies', { ids: rejection.blockers.join(', ') });
    case 'invalid-command':
      return t('board.move.failed');
  }
}

function isBoardTarget(target: EventTarget | null): boolean {
  if (target === null) {
    return false;
  }
  // jsdom can hand back a Window whose identity differs from the global, so
  // match by type as well as identity.
  if (
    target === window ||
    target === document ||
    target === document.body ||
    (typeof Window !== 'undefined' && target instanceof Window)
  ) {
    return true;
  }
  if (!(target instanceof Element)) {
    return false;
  }
  // Match the list's target set: a control inside the board (a filter
  // summary, Clear, Retry) must keep its native Enter behavior. Matching the
  // whole view root here used to swallow those activations and open the
  // focused ticket instead.
  return target.closest('[data-issue-id]') !== null || target.getAttribute('role') === 'list';
}

function LoadingBoard() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('list.state.loading')}
      className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          data-testid="board-skeleton-column"
          aria-hidden="true"
          className="flex h-full w-72 shrink-0 flex-col gap-2 rounded-md border border-border bg-muted/30 p-2"
        >
          <span className="h-3 w-20 rounded bg-muted" />
          <span className="h-24 rounded-md bg-card" />
          <span className="h-24 rounded-md bg-card" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm font-medium">{t('list.state.empty.title')}</p>
      <p className="text-xs text-muted-foreground">{t('list.state.empty.body')}</p>
    </div>
  );
}

function ErrorState({ message, onRefresh }: { message: string; onRefresh?: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <p className="text-sm font-medium text-destructive">{t('list.state.error.title')}</p>
      <p className="text-xs text-muted-foreground">{t('list.state.error.body')}</p>
      <p className="max-w-md text-xs text-muted-foreground">{message}</p>
      {onRefresh === undefined ? null : (
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-border px-3 py-1 text-xs"
        >
          {t('list.state.retry')}
        </button>
      )}
    </div>
  );
}
