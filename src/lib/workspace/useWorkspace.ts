import { useCallback, useEffect, useRef, useState } from 'react';

import type { BdStatus, WorkspaceSnapshot } from '@/bindings/bd';
import { messageOf } from '@/lib/errors';

import { workspaceApi, type WorkspaceApi } from './api';

export type WorkspaceState = {
  snapshot: WorkspaceSnapshot | null;
  bd: BdStatus | null;
  loading: boolean;
  /** Last action error; the previous snapshot is kept when an action fails. */
  error: string | null;
};

export type UseWorkspace = WorkspaceState & {
  reload: () => Promise<void>;
  refreshBd: () => Promise<void>;
  add: (path: string) => Promise<boolean>;
  switchTo: (path: string) => Promise<boolean>;
  remove: (path: string) => Promise<boolean>;
  relocate: (oldPath: string, newPath: string) => Promise<boolean>;
  setBdPath: (path: string | null) => Promise<BdStatus | null>;
};

/**
 * The workspace screen state: registry snapshot, bd status and the actions
 * that mutate them. The API is injected so the hook can be tested without a
 * webview, and the real default talks to the Tauri commands.
 */
export function useWorkspace(api: WorkspaceApi = workspaceApi): UseWorkspace {
  const [state, setState] = useState<WorkspaceState>({
    snapshot: null,
    bd: null,
    loading: true,
    error: null,
  });
  const alive = useRef(true);
  // Only the newest reload may commit: an earlier request can resolve last.
  const reloads = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const generation = ++reloads.current;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const [snapshot, bd] = await Promise.all([api.snapshot(), api.bdStatus(false)]);
      if (alive.current && generation === reloads.current) {
        setState({ snapshot, bd, loading: false, error: null });
      }
    } catch (error) {
      if (alive.current && generation === reloads.current) {
        setState((previous) => ({ ...previous, loading: false, error: messageOf(error) }));
      }
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      try {
        await action();
        await reload();
        return true;
      } catch (error) {
        if (alive.current) {
          setState((previous) => ({ ...previous, error: messageOf(error) }));
        }
        return false;
      }
    },
    [reload]
  );

  const refreshBd = useCallback(async () => {
    try {
      const bd = await api.bdStatus(true);
      if (alive.current) {
        setState((previous) => ({ ...previous, bd, error: null }));
      }
    } catch (error) {
      if (alive.current) {
        setState((previous) => ({ ...previous, error: messageOf(error) }));
      }
    }
  }, [api]);

  const add = useCallback((path: string) => run(() => api.add(path)), [run, api]);
  const switchTo = useCallback((path: string) => run(() => api.switchTo(path)), [run, api]);
  const remove = useCallback((path: string) => run(() => api.remove(path)), [run, api]);
  const relocate = useCallback(
    (oldPath: string, newPath: string) => run(() => api.relocate(oldPath, newPath)),
    [run, api]
  );
  /**
   * Saves the explicit path and hands back the probe result for that path.
   *
   * A rejected path is not persisted, so the effective status is reloaded from
   * the registry rather than replaced by the failed attempt: the app keeps
   * using the bd it already had while Settings shows why the new one was
   * refused.
   */
  const setBdPath = useCallback(
    async (path: string | null): Promise<BdStatus | null> => {
      try {
        const status = await api.setBdPath(path);
        await reload();
        return status;
      } catch (error) {
        if (alive.current) {
          setState((previous) => ({ ...previous, error: messageOf(error) }));
        }
        return null;
      }
    },
    [api, reload]
  );

  return {
    ...state,
    reload,
    refreshBd,
    add,
    switchTo,
    remove,
    relocate,
    setBdPath,
  };
}
