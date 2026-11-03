import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  createListViewState,
  hasViewParams,
  parseListViewState,
  serializeListViewState,
  type ListViewState,
} from './state';
import { loadSavedView, saveSavedView } from './storage';

export type ViewSurface = 'list' | 'board';

/**
 * URL + saved-view state shared by the list and the board.
 *
 * The URL wins; without view parameters the view the user last used is kept.
 * The board never edits grouping or sorting, so it keeps the list's values in
 * storage and leaves them out of its URL — that is the only difference between
 * the two surfaces.
 */
export function usePersistedView(
  projectId: string,
  surface: ViewSurface = 'list'
): { view: ListViewState; updateView: (next: ListViewState) => void } {
  const board = surface === 'board';
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const hasParams = useMemo(() => hasViewParams(new URLSearchParams(search)), [search]);
  const savedView = useMemo(() => loadSavedView(projectId), [projectId]);
  // Read the stored view once per mount instead of on every filter keystroke.
  const storedView = useMemo(() => savedView ?? createListViewState(), [savedView]);
  const latestViewRef = useRef<ListViewState | null>(null);

  const view = useMemo(() => {
    if (hasParams) {
      return parseListViewState(new URLSearchParams(search));
    }
    return latestViewRef.current ?? savedView ?? createListViewState();
  }, [hasParams, savedView, search]);

  useEffect(() => {
    latestViewRef.current = view;
    saveSavedView(projectId, board ? { ...storedView, filter: view.filter } : view);
  }, [board, projectId, storedView, view]);

  // Write a remembered view back to the URL, on mount with a saved view or
  // after a navigation dropped the query string. Unknown-only URLs compare
  // equal and are left alone.
  useEffect(() => {
    if (hasParams) {
      return;
    }
    const next = serialize(view, new URLSearchParams(search), board);
    if (next.toString() !== '' && next.toString() !== search) {
      setSearchParams(next, { replace: true });
    }
  }, [board, hasParams, search, setSearchParams, view]);

  const updateView = useCallback(
    (next: ListViewState) => {
      // Keep the fallback in sync so an explicit clear (which empties the URL)
      // is not mistaken for a navigation that dropped the parameters.
      latestViewRef.current = next;
      setSearchParams((previous) => serialize(next, previous, board), { replace: true });
    },
    [board, setSearchParams]
  );

  return { view, updateView };
}

function serialize(view: ListViewState, params: URLSearchParams, board: boolean): URLSearchParams {
  const next = serializeListViewState(view, params);
  if (board) {
    next.delete('group');
    next.delete('sort');
  }
  return next;
}
