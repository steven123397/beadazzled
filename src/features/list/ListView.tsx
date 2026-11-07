import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SearchX } from 'lucide-react';

import type { Issue, SyncState } from '@/bindings/bd';
import { isEditableTarget, isOverlayOpen } from '@/app/keyboard/resolve';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/ui/state-badge';
import { FilterBar } from '@/components/filter-bar';
import { EmptyState, ErrorState, HEALTHY, StaleBanner, useOpenIssue } from '@/components/view-states';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { buildSearchIndex, hasActiveFilters } from '@/lib/view/filter';
import { createListViewState, type GroupBy } from '@/lib/view/state';
import { usePersistedView } from '@/lib/view/usePersistedView';

import { selectVisibleIssues } from './filter';
import { GROUP_HEIGHT, GroupHeader } from './GroupHeader';
import { groupIssues } from './group';
import { loadListPosition, saveListPosition } from './position';
import { Row, rowId } from './Row';

/** Must match `--row-height` in tokens.css. */
const ROW_HEIGHT = 42;
const OVERSCAN = 10;
const INITIAL_RECT = { width: 0, height: 600 };


type ListItem = { kind: 'header'; key: string; count: number } | { kind: 'row'; issue: Issue };

type ListState = 'loading' | 'empty' | 'no-match' | 'bd-unavailable' | 'ready';

export type ListViewProps = {
  projectId: string;
  issues: readonly Issue[];
  syncState?: SyncState;
  onRefresh?: () => void;
};

export type ListRouteProps = {
  issues: readonly Issue[];
  syncState?: SyncState;
  onRefresh?: () => void;
};

/** Reads the route param and remounts the list when the workspace changes. */
export function ListRoute({ issues, syncState, onRefresh }: ListRouteProps) {
  const { projectId = '' } = useParams<{ projectId: string }>();
  return (
    <ListView
      key={projectId}
      projectId={projectId}
      issues={issues}
      syncState={syncState}
      onRefresh={onRefresh}
    />
  );
}

export function ListView({ projectId, issues, syncState = HEALTHY, onRefresh }: ListViewProps) {
  const { t } = useI18n();
  const { view, updateView } = usePersistedView(projectId);

  const initialPosition = useMemo(() => loadListPosition(projectId), [projectId]);
  const searchText = useMemo(() => buildSearchIndex(issues), [issues]);
  const visible = useMemo(
    () => selectVisibleIssues(issues, view, { searchText }),
    [issues, view, searchText]
  );
  const activeFilters = hasActiveFilters(view.filter);
  const showType = useMemo(
    () => new Set(visible.map((issue) => issue.issue_type)).size > 1,
    [visible]
  );

  const [focusedId, setFocusedId] = useState<string | null>(initialPosition?.focusedId ?? null);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedIdRef = useRef(focusedId);
  // Only a visible row may request focus; the restore path sets this itself
  // when it finds the saved row. Keeping a missing saved id here would let it
  // steal focus later, when a filter change makes that row appear again.
  const pendingFocusRef = useRef<string | null>(null);
  // Bumped whenever pendingFocusRef is set, so the focus effect runs even when
  // focusedId did not change (restoring an already-focused row).
  const [focusRequest, setFocusRequest] = useState(0);
  const restoredRef = useRef(false);

  focusedIdRef.current = focusedId;

  useEffect(() => {
    setCollapsedGroups(new Set());
  }, [view.group]);

  const groups = useMemo(
    () => (view.group === 'none' ? [] : groupIssues(visible, view.group)),
    [visible, view.group]
  );
  const items = useMemo<ListItem[]>(() => {
    if (view.group === 'none') {
      return visible.map((issue) => ({ kind: 'row' as const, issue }));
    }
    return groups.flatMap((group) => {
      const header: ListItem = {
        kind: 'header',
        key: group.key,
        count: group.issues.length,
      };
      return collapsedGroups.has(group.key)
        ? [header]
        : [header, ...group.issues.map((issue) => ({ kind: 'row' as const, issue }))];
    });
  }, [collapsedGroups, groups, view.group, visible]);

  const rowMeta = useMemo(() => {
    const byId = new Map<string, { itemIndex: number; position: number }>();
    const order: string[] = [];
    items.forEach((item, itemIndex) => {
      if (item.kind === 'row') {
        byId.set(item.issue.id, { itemIndex, position: order.length });
        order.push(item.issue.id);
      }
    });
    return { byId, order, count: order.length };
  }, [items]);

  const itemsRef = useRef(items);
  const rowMetaRef = useRef(rowMeta);
  itemsRef.current = items;
  rowMetaRef.current = rowMeta;

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(
    (index: number) => (items[index]?.kind === 'header' ? GROUP_HEIGHT : ROW_HEIGHT),
    [items]
  );
  const getItemKey = useCallback(
    (index: number) => {
      const item = items[index];
      if (item === undefined) {
        return index;
      }
      return item.kind === 'header' ? `header:${item.key}` : item.issue.id;
    },
    [items]
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
    initialRect: INITIAL_RECT,
  });

  const openIssue = useOpenIssue(projectId);

  const focusRow = useCallback(
    (id: string) => {
      const meta = rowMetaRef.current.byId.get(id);
      if (meta === undefined) {
        return;
      }
      pendingFocusRef.current = id;
      setFocusedId(id);
      setFocusRequest((value) => value + 1);
      virtualizer.scrollToIndex(meta.itemIndex, { align: 'auto' });
    },
    [virtualizer]
  );

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    updateView({ ...view, filter: createListViewState().filter });
  }, [updateView, view]);

  const total = issues.length;
  const state: ListState =
    syncState.kind === 'loading' && total === 0
      ? 'loading'
      : syncState.kind === 'bd-unavailable'
        ? 'bd-unavailable'
        : total === 0
          ? 'empty'
          : visible.length === 0 && activeFilters
            ? 'no-match'
            : 'ready';

  // Restore once the first non-empty snapshot is available. Waiting matters
  // when sync paints an empty list first and fills it a frame later. The
  // restore itself runs in a frame: StrictMode re-runs the virtualizer's layout
  // effect and that pass writes scrollTop 0, so doing it here would be undone.
  useEffect(() => {
    if (restoredRef.current || items.length === 0) {
      return;
    }
    if (initialPosition === null) {
      restoredRef.current = true;
      return;
    }

    const element = scrollRef.current;
    if (element === null) {
      return;
    }

    requestAnimationFrame(() => {
      if (!element.isConnected) {
        // The first non-empty snapshot was stale (e.g. the previous workspace)
        // or the list went back to a state screen. Leave the flag false so the
        // next snapshot retries the restore.
        return;
      }
      element.scrollTop = initialPosition.scrollTop;
      virtualizer.scrollToOffset(initialPosition.scrollTop);
      restoredRef.current = true;

      if (initialPosition.focusedId !== null) {
        const meta = rowMetaRef.current.byId.get(initialPosition.focusedId);
        if (meta !== undefined) {
          pendingFocusRef.current = initialPosition.focusedId;
          setFocusedId(initialPosition.focusedId);
          setFocusRequest((value) => value + 1);
          virtualizer.scrollToIndex(meta.itemIndex, { align: 'auto' });
        } else {
          // The saved row is filtered out or gone; do not keep a ghost focus.
          setFocusedId(null);
        }
      }
    });
  }, [initialPosition, items.length, virtualizer]);

  // Save in a layout cleanup: by passive-effect cleanup time the scroll
  // container may already be detached, which would persist offset zero.
  useLayoutEffect(() => {
    return () => {
      // A no-match or error screen has no scroll container; saving 0 here would
      // clobber a position the user can still return to.
      const element = scrollRef.current;
      if (!restoredRef.current || element === null) {
        return;
      }
      saveListPosition(projectId, {
        scrollTop: element.scrollTop,
        focusedId: focusedIdRef.current,
      });
    };
  }, [projectId]);

  // Focus the requested row after the virtualizer has rendered it.
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id === null) {
      return;
    }
    const element = document.getElementById(rowId(id));
    if (element === null) {
      return;
    }
    pendingFocusRef.current = null;
    element.focus({ preventScroll: true });
  }, [focusedId, focusRequest, virtualItems]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      // A dialog owns the keyboard; moving focus to a row would escape its trap.
      if (isOverlayOpen()) {
        return;
      }

      const meta = rowMetaRef.current;
      if (meta.count === 0) {
        return;
      }
      const currentId = focusedIdRef.current;
      const current = currentId === null ? undefined : meta.byId.get(currentId);
      const position = current?.position ?? -1;

      if (event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        focusRow(meta.order[position < 0 ? 0 : Math.min(position + 1, meta.count - 1)] ?? '');
        return;
      }
      if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        focusRow(meta.order[position < 0 ? meta.count - 1 : Math.max(position - 1, 0)] ?? '');
        return;
      }
      if (event.key === 'Enter' && current !== undefined && isListTarget(event.target)) {
        const item = itemsRef.current[current.itemIndex];
        if (item?.kind === 'row') {
          event.preventDefault();
          openIssue(item.issue);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusRow, openIssue]);

  return (
    <section
      data-testid="list-view"
      data-state={state}
      data-sync={syncState.kind}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-base font-semibold">{t('nav.list')}</h1>
      </header>
      {total > 0 ? (
        <FilterBar
          view={view}
          issues={issues}
          visibleCount={visible.length}
          totalCount={total}
          onChange={updateView}
          onClear={clearFilters}
        />
      ) : null}
      {syncState.kind === 'bd-unavailable' && total > 0 ? (
        <StaleBanner onRefresh={onRefresh} />
      ) : null}

      {state === 'loading' ? (
        <LoadingRows label={t('list.state.loading')} />
      ) : state === 'empty' ? (
        <EmptyState
          footer={
            <>
              <Button size="md" variant="secondary" disabled className="mt-1">
                {t('list.state.empty.create')}
              </Button>
              <p className="max-w-sm text-xs text-muted-foreground">
                {t('list.state.empty.createDisabled')}
              </p>
            </>
          }
        />
      ) : syncState.kind === 'bd-unavailable' && total === 0 ? (
        <ErrorState message={syncState.error.message} onRefresh={onRefresh} />
      ) : visible.length === 0 && activeFilters ? (

        <NoMatchState onClear={clearFilters} />
      ) : (
        <div
          ref={scrollRef}
          role="list"
          aria-label={t('list.issues')}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto thin-scrollbar pb-2"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((item) => {
              const entry = items[item.index];
              if (entry === undefined) {
                return null;
              }
              if (entry.kind === 'header') {
                if (view.group === 'none') {
                  return null;
                }
                return (
                  <GroupHeader
                    key={item.key}
                    group={view.group as Exclude<GroupBy, 'none'>}
                    groupKey={entry.key}
                    count={entry.count}
                    collapsed={collapsedGroups.has(entry.key)}
                    start={item.start}
                    onToggle={toggleGroup}
                  />
                );
              }
              return (
                <Row
                  key={item.key}
                  issue={entry.issue}
                  start={item.start}
                  focused={entry.issue.id === focusedId}
                  showType={showType}
                  onOpen={openIssue}
                  onFocus={setFocusedId}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function LoadingRows({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="min-h-0 flex-1 overflow-hidden"
    >
      {Array.from({ length: 10 }, (_, index) => (
        <div
          key={index}
          data-testid="list-skeleton-row"
          aria-hidden="true"
          className="mx-1 flex items-center gap-3 rounded-md bg-muted/30 px-3"
          style={{ height: 'var(--row-height)' }}
        >
          <span className="h-3 w-24 rounded bg-muted" />
          <span className="h-3 w-16 rounded bg-muted" />
          <span className="h-3 flex-1 rounded bg-muted" />
          <span className="h-3 w-8 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function NoMatchState({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center">
      <StateBadge icon={<SearchX aria-hidden="true" className="size-4" />} />
      <p className="text-sm font-medium">{t('list.state.noMatch.title')}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{t('list.state.noMatch.body')}</p>
      <Button size="md" variant="secondary" onClick={onClear} className="mt-1">
        {t('list.state.noMatch.clear')}
      </Button>
    </div>
  );
}


/**
 * Enter only activates the list when the event came from the list itself. A
 * button in the top bar must keep its native Enter behavior.
 */
function isListTarget(target: EventTarget | null): boolean {
  if (target === null) {
    return false;
  }
  if (target === window || target === document || target === document.body) {
    return true;
  }
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest('[data-issue-id]') !== null || target.getAttribute('role') === 'list';
}
