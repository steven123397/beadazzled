import { createContext, useContext, type ReactNode } from 'react';

import type { BridgeError, SyncState } from '@/bindings/bd';
import type { MessageKey } from '@/lib/i18n';

export type SyncTone = 'neutral' | 'positive' | 'warning' | 'danger';

const TONE_CLASS: Record<SyncTone, string> = {
  neutral: 'text-muted-foreground',
  positive: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
};

export function syncToneClass(tone: SyncTone): string {
  return TONE_CLASS[tone];
}

export type SyncLabel = {
  key: MessageKey;
  tone: SyncTone;
  vars?: Record<string, string | number>;
};

/** User-facing label for every `SyncState`; the switch is exhaustive on purpose. */
export function describeSyncState(state: SyncState): SyncLabel {
  switch (state.kind) {
    case 'loading':
      return {
        key: state.step === 'export' ? 'status.loadingIssues' : 'status.loadingJournal',
        tone: 'neutral',
      };
    case 'healthy':
      return { key: 'status.live', tone: 'positive' };
    case 'journal-disabled':
      return { key: 'status.journalOff', tone: 'warning' };
    case 'journal-truncated':
      return {
        key: state.recovered ? 'status.caughtUp' : 'status.rebuilding',
        tone: 'warning',
      };
    case 'restarting':
      return { key: 'status.reconnecting', tone: 'warning', vars: { attempt: state.attempt } };
    case 'bd-unavailable':
      return { key: 'status.bdUnavailable', tone: 'danger' };
  }
}

const SyncStatusContext = createContext<SyncState>({ kind: 'loading', step: 'export' });

/**
 * The most recent sync error, kept after the state recovers.
 *
 * `SyncState` only describes what is true now, so a bd hiccup that healed
 * leaves no trace in it. Settings still has to show the code, the time and the
 * summary of what went wrong (SPEC-settings §同步), so the shell remembers the
 * latest one for the life of the session.
 */
export type SyncErrorRecord = {
  code: BridgeError['code'];
  /** Epoch milliseconds when this error was first observed. */
  at: number;
  message: string;
  detail?: BridgeError['detail'];
};

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
