import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { Issue } from '@/bindings/bd';
import { isEditableTarget } from '@/app/keyboard/resolve';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { buildSearchIndex, selectVisibleIssues } from './filter';
import { loadListPosition, saveListPosition } from './position';
import { Row, rowId } from './Row';
import { createListViewState, type ListViewState } from './view-state';

/** Must match `--row-height` in tokens.css. */
const ROW_HEIGHT = 36;
const OVERSCAN = 10;
const INITIAL_RECT = { width: 0, height: 600 };

export type ListViewProps = {
  projectId: string;
  issues: readonly Issue[];
  /** Supplied by the URL state layer; the unfiltered list is the default. */
  view?: ListViewState;
};

/** Reads the route param and remounts the list when the workspace changes. */
export function ListRoute({ issues }: { issues: readonly Issue[] }) {
  const { projectId = '' } = useParams<{ projectId: string }>();
  return <ListView key={projectId} projectId={projectId} issues={issues} />;
}

export function ListView({ projectId, issues, view: viewProp }: ListViewProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const initialPosition = useMemo(() => loadListPosition(projectId), [projectId]);
  const view = useMemo(() => viewProp ?? createListViewState(), [viewProp]);
  const searchText = useMemo(() => buildSearchIndex(issues), [issues]);
  const visible = useMemo(
    () => selectVisibleIssues(issues, view, { searchText }),
    [issues, view, searchText]
  );

  const [focusedId, setFocusedId] = useState<string | null>(initialPosition?.focusedId ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedIdRef = useRef(focusedId);
  const visibleRef = useRef(visible);
  const pendingFocusRef = useRef<string | null>(initialPosition?.focusedId ?? null);
  const restoredRef = useRef(false);

  focusedIdRef.current = focusedId;
  visibleRef.current = visible;

  const getScrollElement = useCallback(() => scrollRef.current, []);
  const estimateSize = useCallback(() => ROW_HEIGHT, []);
  const getItemKey = useCallback((index: number) => visible[index]?.id ?? index, [visible]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
    initialRect: INITIAL_RECT,
  });

  const openIssue = useCallback(
    (issue: Issue) => {
      navigate(`/w/${projectId}/issue/${encodeURIComponent(issue.id)}`);
    },
    [navigate, projectId]
  );

  const moveFocus = useCallback(
    (index: number) => {
      const issue = visibleRef.current[index];
      if (issue === undefined) {
        return;
      }
      pendingFocusRef.current = issue.id;
      setFocusedId(issue.id);
      virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [virtualizer]
  );

  // Restore once the first non-empty snapshot is available. Waiting matters
  // when sync paints an empty list first and fills it a frame later. The
  // restore itself runs in a frame: StrictMode re-runs the virtualizer's layout
  // effect and that pass writes scrollTop 0, so doing it here would be undone.
  useEffect(() => {
    if (restoredRef.current || visible.length === 0) {
      return;
    }
    restoredRef.current = true;
    if (initialPosition === null) {
      return;
    }

    const element = scrollRef.current;
    if (element === null) {
      return;
    }

    requestAnimationFrame(() => {
      if (!element.isConnected) {
        return;
      }
      element.scrollTop = initialPosition.scrollTop;
      virtualizer.scrollToOffset(initialPosition.scrollTop);

      if (initialPosition.focusedId !== null) {
        const index = visible.findIndex((issue) => issue.id === initialPosition.focusedId);
        if (index >= 0) {
          pendingFocusRef.current = initialPosition.focusedId;
          setFocusedId(initialPosition.focusedId);
          virtualizer.scrollToIndex(index, { align: 'auto' });
        }
      }
    });
  }, [initialPosition, visible, virtualizer]);

  // Save in a layout cleanup: by passive-effect cleanup time the scroll
  // container may already be detached, which would persist offset zero.
  useLayoutEffect(() => {
    return () => {
      if (!restoredRef.current) {
        return;
      }
      saveListPosition(projectId, {
        scrollTop: scrollRef.current?.scrollTop ?? 0,
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
  }, [focusedId, virtualItems]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      const list = visibleRef.current;
      if (list.length === 0) {
        return;
      }
      const currentId = focusedIdRef.current;
      const index = currentId === null ? -1 : list.findIndex((issue) => issue.id === currentId);

      if (event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        moveFocus(index < 0 ? 0 : Math.min(index + 1, list.length - 1));
        return;
      }
      if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        moveFocus(index < 0 ? list.length - 1 : Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter' && index >= 0 && isListTarget(event.target)) {
        event.preventDefault();
        openIssue(list[index]);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moveFocus, openIssue]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <h1 className="text-sm font-semibold">{t('nav.list')}</h1>
        <span
          className="text-xs tabular-nums text-muted-foreground"
          aria-label={t('list.visibleCount', { count: visible.length })}
        >
          {visible.length}
        </span>
      </header>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label={t('list.issues')}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((item) => {
            const issue = visible[item.index];
            if (issue === undefined) {
              return null;
            }
            return (
              <Row
                key={item.key}
                issue={issue}
                start={item.start}
                focused={issue.id === focusedId}
                onOpen={openIssue}
                onFocus={setFocusedId}
              />
            );
          })}
        </div>
      </div>
    </section>
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
  return target.closest('[role="option"]') !== null || target.getAttribute('role') === 'listbox';
}
