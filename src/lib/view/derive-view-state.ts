import type { SyncState } from '@/bindings/bd';

export type ViewContentState = 'loading' | 'empty' | 'no-match' | 'bd-unavailable' | 'ready';

type DeriveViewStateInput = {
  syncKind: SyncState['kind'];
  total: number;
  /** List uses its full-screen no-match state; Board keeps its empty columns. */
  noMatch?: boolean;
};

/** Derives content presentation only; sync health remains in `data-sync` (ADR-0016). */
export function deriveViewState({
  syncKind,
  total,
  noMatch = false,
}: DeriveViewStateInput): ViewContentState {
  if (syncKind === 'loading' && total === 0) {
    return 'loading';
  }
  if (syncKind === 'bd-unavailable' && total === 0) {
    return 'bd-unavailable';
  }
  if (total === 0) {
    return 'empty';
  }
  if (noMatch) {
    return 'no-match';
  }
  return 'ready';
}
