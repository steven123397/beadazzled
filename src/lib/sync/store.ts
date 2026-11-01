import type { Issue, JournalRecord } from '@/bindings/bd';

import {
  applyRecords as reduceRecords,
  applySnapshot as reduceSnapshot,
  createTicketState,
  emptyRecord,
  type TicketState,
} from './reducer';

/** Derived lookups for list/board filtering, rebuilt lazily after a change. */
export type TicketIndexes = {
  byStatus: Record<string, string[]>;
  byPriority: Record<string, string[]>;
  /** Unassigned issues use the empty key. */
  byAssignee: Record<string, string[]>;
  byLabel: Record<string, string[]>;
  /** Lower-cased id, title and description per issue. */
  searchText: Record<string, string>;
};

export type StoreReport = {
  applied: number;
  needsBaseline: boolean;
};

export type TicketStore = {
  getState(): TicketState;
  getIndexes(): TicketIndexes;
  /** Replaces everything with an export snapshot taken at `since`. */
  applySnapshot(issues: readonly Issue[], since?: number): void;
  /** Applies a journal batch; `needsBaseline` is set when a seq was skipped. */
  applyRecords(records: readonly JournalRecord[]): StoreReport;
  subscribe(listener: () => void): () => void;
};

export function createTicketStore(initial: TicketState = createTicketState()): TicketStore {
  let state = initial;
  let cached: { state: TicketState; indexes: TicketIndexes } | null = null;
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
    getIndexes() {
      if (!cached || cached.state !== state) {
        cached = { state, indexes: buildIndexes(state.issues) };
      }
      return cached.indexes;
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

function buildIndexes(issues: Record<string, Issue>): TicketIndexes {
  const byStatus = emptyRecord<string[]>();
  const byPriority = emptyRecord<string[]>();
  const byAssignee = emptyRecord<string[]>();
  const byLabel = emptyRecord<string[]>();
  const searchText = emptyRecord<string>();

  for (const issue of Object.values(issues)) {
    push(byStatus, issue.status, issue.id);
    push(byPriority, String(issue.priority), issue.id);
    push(byAssignee, issue.assignee ?? '', issue.id);
    for (const label of issue.labels) {
      push(byLabel, label, issue.id);
    }
    searchText[issue.id] = `${issue.id} ${issue.title} ${issue.description}`.toLowerCase();
  }

  return { byStatus, byPriority, byAssignee, byLabel, searchText };
}

function push(map: Record<string, string[]>, key: string, value: string): void {
  (map[key] ??= []).push(value);
}