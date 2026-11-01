import { createContext, useContext, type ReactNode } from 'react';

import type { SyncState } from '@/bindings/bd';

export type SyncTone = 'neutral' | 'positive' | 'warning' | 'danger';

const TONE_CLASS: Record<SyncTone, string> = {
  neutral: 'text-neutral-400',
  positive: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
};

export function syncToneClass(tone: SyncTone): string {
  return TONE_CLASS[tone];
}

/** User-facing label for every `SyncState`; the switch is exhaustive on purpose. */
export function describeSyncState(state: SyncState): { label: string; tone: SyncTone } {
  switch (state.kind) {
    case 'loading':
      return {
        label: state.step === 'export' ? 'Loading issues' : 'Loading journal',
        tone: 'neutral',
      };
    case 'healthy':
      return { label: 'Live', tone: 'positive' };
    case 'journal-disabled':
      return { label: 'Journal off', tone: 'warning' };
    case 'journal-truncated':
      return { label: state.recovered ? 'Caught up' : 'Rebuilding', tone: 'warning' };
    case 'restarting':
      return { label: `Reconnecting (attempt ${state.attempt})`, tone: 'warning' };
    case 'bd-unavailable':
      return { label: 'bd unavailable', tone: 'danger' };
  }
}

const SyncStatusContext = createContext<SyncState>({ kind: 'loading', step: 'export' });

export function SyncStatusProvider({ state, children }: { state: SyncState; children: ReactNode }) {
  return <SyncStatusContext.Provider value={state}>{children}</SyncStatusContext.Provider>;
}

export function useSyncState(): SyncState {
  return useContext(SyncStatusContext);
}
