import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { BridgeError, Issue, JournalRecord, SyncState } from '@/bindings/bd';

import { syncApi, type SyncApi, type SyncSnapshot } from './api';
import { createTicketStore, type TicketStore } from './store';

const LOADING: SyncState = { kind: 'loading', step: 'export' };

export type UseSyncOptions = {
  /** The workspace path the route is showing; `null` stops the worker. */
  workspace: string | null;
  /** bd must be ready before the worker can read anything. */
  ready: boolean;
  /** Disabled in unit tests and the browser e2e seam, which inject fixtures. */
  enabled?: boolean;
  api?: SyncApi;
};

export type SyncControl = {
  issues: readonly Issue[];
  state: SyncState;
  /** Highest journal seq applied to the store; 0 before the first snapshot. */
  lastSeq: number;
  refresh: () => void;
  /** The live store behind `issues`; writes wait on its echo cursor. */
  store: TicketStore;
};

/**
 * Owns the ticket store for the active workspace: subscribes to the Tauri sync
 * events, starts the backend worker after the listeners are in place, and
 * exposes the issues/state the shell renders.
 */
export function useSync({
  workspace,
  ready,
  enabled = true,
  api = syncApi,
}: UseSyncOptions): SyncControl {
  const [store] = useState(createTicketStore);
  const [state, setState] = useState<SyncState>(LOADING);
  // Read at rejection time: a request from the previous workspace must not
  // paint its error over the current one.
  const activeWorkspace = useRef<string | null>(workspace);
  const ticketState = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const issues = useMemo(() => Object.values(ticketState.issues), [ticketState]);

  useEffect(() => {
    activeWorkspace.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    if (workspace === null || !ready) {
      store.applySnapshot([], 0);
      setState(LOADING);
      void api.stop().catch(() => undefined);
      return undefined;
    }

    let cancelled = false;
    const unlisten: Array<() => void> = [];
    store.applySnapshot([], 0);
    setState(LOADING);

    void (async () => {
      const unsubscribers = await Promise.all([
        api.listen<SyncSnapshot>('snapshot', (payload) => {
          if (!cancelled) {
            store.applySnapshot(payload.issues, payload.since);
          }
        }),
        api.listen<JournalRecord[]>('records', (records) => {
          if (cancelled) {
            return;
          }
          const report = store.applyRecords(records);
          if (report.needsBaseline) {
            void api.refresh(workspace).catch((error) => {
              if (!cancelled) {
                setState(unavailable(error));
              }
            });
          }
        }),
        api.listen<SyncState>('state', (next) => {
          if (!cancelled) {
            setState(next);
          }
        }),
      ]);

      if (cancelled) {
        unsubscribers.forEach((unsubscribe) => unsubscribe());
        return;
      }
      unlisten.push(...unsubscribers);

      try {
        await api.start(workspace);
      } catch (error) {
        if (!cancelled) {
          setState(unavailable(error));
        }
      }
    })().catch((error) => {
      if (!cancelled) {
        setState(unavailable(error));
      }
    });

    return () => {
      cancelled = true;
      unlisten.forEach((unsubscribe) => unsubscribe());
      void api.stop().catch(() => undefined);
    };
  }, [api, enabled, ready, store, workspace]);

  const refresh = useCallback(() => {
    if (!enabled || workspace === null || !ready) {
      return;
    }
    void api.refresh(workspace).catch((error) => {
      if (activeWorkspace.current === workspace) {
        setState(unavailable(error));
      }
    });
  }, [api, enabled, ready, workspace]);

  return { issues, state, lastSeq: ticketState.lastSeq, refresh, store };
}

function unavailable(error: unknown): SyncState {
  if (isBridgeError(error)) {
    return {
      kind: 'bd-unavailable',
      error: {
        code: error.code,
        message: error.message,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
      },
    };
  }
  return {
    kind: 'bd-unavailable',
    error: {
      code: 'INTERNAL',
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function isBridgeError(value: unknown): value is BridgeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  );
}
