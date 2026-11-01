import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type { Issue } from '@/bindings/bd';
import type { Invoke } from '@/lib/invoke';

export const SYNC_EVENTS = {
  snapshot: 'sync:snapshot',
  records: 'sync:records',
  state: 'sync:state',
} as const;

export type SyncEvent = keyof typeof SYNC_EVENTS;

/** The payload emitted after `bd export`; `since` seeds the journal cursor. */
export type SyncSnapshot = {
  issues: Issue[];
  since: number;
};

export type SyncApi = {
  start(workspace: string): Promise<void>;
  refresh(workspace: string): Promise<void>;
  stop(): Promise<void>;
  listen<T>(event: SyncEvent, handler: (payload: T) => void): Promise<UnlistenFn>;
};

/**
 * The Tauri boundary for the sync worker. Kept behind an injected type so the
 * hook can be tested with a fake event bus.
 */
export function createSyncApi(call: Invoke = invoke): SyncApi {
  return {
    start: (workspace) => call<void>('sync_start', { workspace }),
    refresh: (workspace) => call<void>('sync_refresh', { workspace }),
    stop: () => call<void>('sync_stop'),
    listen: <T>(event: SyncEvent, handler: (payload: T) => void) =>
      listen<T>(SYNC_EVENTS[event], (message) => handler(message.payload)),
  };
}

export const syncApi = createSyncApi();