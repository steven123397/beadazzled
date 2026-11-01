import { useCallback, useEffect, useRef, useState } from 'react';

import type { BdStatus, BridgeError, WorkspaceSnapshot } from '@/bindings/bd';
import { describeError } from '@/lib/errors';

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
  setBdPath: (path: string | null) => Promise<boolean>;
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

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const [snapshot, bd] = await Promise.all([api.snapshot(), api.bdStatus(false)]);
      if (alive.current) {
        setState({ snapshot, bd, loading: false, error: null });
      }
    } catch (error) {
      if (alive.current) {
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
  const setBdPath = useCallback(
    (path: string | null) => run(() => api.setBdPath(path)),
    [run, api]
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

function messageOf(error: unknown): string {
  if (isBridgeError(error)) {
    return describeError(error).message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isBridgeError(value: unknown): value is BridgeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}