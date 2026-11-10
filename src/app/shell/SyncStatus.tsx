import { createContext, useContext, type ReactNode } from 'react';

import type { SyncState } from '@/bindings/bd';
import type { SyncErrorRecord } from '@/lib/sync/labels';

export { describeSyncState, recordSyncError, syncToneClass } from '@/lib/sync/labels';
export type { SyncErrorRecord, SyncLabel, SyncTone } from '@/lib/sync/labels';

const SyncStatusContext = createContext<SyncState>({ kind: 'loading', step: 'export' });
const SyncErrorContext = createContext<SyncErrorRecord | null>(null);

export function SyncStatusProvider({
  state,
  lastError = null,
  children,
}: {
  state: SyncState;
  lastError?: SyncErrorRecord | null;
  children: ReactNode;
}) {
  return (
    <SyncStatusContext.Provider value={state}>
      <SyncErrorContext.Provider value={lastError}>{children}</SyncErrorContext.Provider>
    </SyncStatusContext.Provider>
  );
}

export function useSyncState(): SyncState {
  return useContext(SyncStatusContext);
}

export function useSyncErrorHistory(): SyncErrorRecord | null {
  return useContext(SyncErrorContext);
}
