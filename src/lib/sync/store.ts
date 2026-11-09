import type { Issue, JournalRecord } from '@/bindings/bd';

import {
  applyRecords as reduceRecords,
  applySnapshot as reduceSnapshot,
  createTicketState,
  type TicketState,
} from './reducer';

export type StoreReport = {
  applied: number;
  needsBaseline: boolean;
};

export type TicketStore = {
  getState(): TicketState;
  /** Replaces everything with an export snapshot taken at `since`. */
  applySnapshot(issues: readonly Issue[], since?: number): void;
  /** Applies a journal batch; `needsBaseline` is set when a seq was skipped. */
  applyRecords(records: readonly JournalRecord[]): StoreReport;
  subscribe(listener: () => void): () => void;
};

export function createTicketStore(initial: TicketState = createTicketState()): TicketStore {
  let state = initial;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    getState() {
      return state;
    },
    applySnapshot(issues, since = 0) {
      state = reduceSnapshot(issues, since);
      notify();
    },
    applyRecords(records) {
      const report = reduceRecords(state, records);
      if (report.state !== state) {
        state = report.state;
        notify();
      }
      return { applied: report.applied, needsBaseline: report.gap };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
