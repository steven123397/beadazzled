import type { Comment, Issue, JournalRecord } from '@/bindings/bd';

/** Everything the UI reads: the issue map plus the journal cursor. */
export type TicketState = {
  issues: Record<string, Issue>;
  /** Highest journal seq applied to this state. */
  lastSeq: number;
  /** Highest seq seen per issue, used by `waitForEcho`. */
  issueSeq: Record<string, number>;
};

export type ApplyReport = {
  state: TicketState;
  applied: number;
  /** A skipped sequence was seen; the caller must run a full baseline. */
  gap: boolean;
};

/**
 * Untrusted keys (issue ids, labels, assignees) must not collide with
 * `Object.prototype` entries such as `constructor` or `__proto__`: a plain
 * `{}` makes `map['constructor']` inherit a function and `map['__proto__']`
 * write through the prototype setter.
 */
export function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copyRecord<T>(source: Record<string, T>): Record<string, T> {
  return Object.assign(emptyRecord<T>(), source);
}

export function createTicketState(): TicketState {
  return { issues: emptyRecord<Issue>(), lastSeq: 0, issueSeq: emptyRecord<number>() };
}

/** Replaces the store with a `bd export` snapshot. */
export function applySnapshot(issues: readonly Issue[], since = 0): TicketState {
  const map = emptyRecord<Issue>();
  for (const issue of issues) {
    map[issue.id] = issue;
  }
  return { issues: map, lastSeq: since, issueSeq: emptyRecord<number>() };
}

/**
 * Applies journal records in order, stopping at the first skipped seq.
 *
 * The issue map and the per-issue cursor are copied once per batch, not once
 * per record: 1000 events over 1000 issues stays well inside the 100ms budget.
 */
export function applyRecords(
  state: TicketState,
  records: readonly JournalRecord[]
): ApplyReport {
  let issues: Record<string, Issue> | null = null;
  let issueSeq: Record<string, number> | null = null;
  let lastSeq = state.lastSeq;
  let applied = 0;
  let gap = false;

  for (const record of records) {
    if (record.seq <= lastSeq) {
      continue;
    }
    if (record.seq !== lastSeq + 1) {
      gap = true;
      break;
    }
    issues ??= copyRecord(state.issues);
    issueSeq ??= copyRecord(state.issueSeq);
    applyOne(issues, issueSeq, record);
    lastSeq = record.seq;
    applied += 1;
  }

  if (issues === null || issueSeq === null) {
    return { state, applied: 0, gap };
  }
  return { state: { issues, lastSeq, issueSeq }, applied, gap };
}

function applyOne(
  issues: Record<string, Issue>,
  issueSeq: Record<string, number>,
  record: JournalRecord
): void {
  issueSeq[record.issue_id] = record.seq;

  switch (record.op) {
    case 'delete':
      delete issues[record.issue_id];
      return;
    case 'comment':
      if (record.issue) {
        upsert(issues, record.issue);
      } else {
        appendComment(issues, record);
      }
      return;
    case 'create':
    case 'update':
    case 'close':
    case 'dep_add':
    case 'dep_remove':
      if (record.issue) {
        upsert(issues, record.issue);
      }
      return;
    default:
      // Unknown operation from a newer bd: advance the cursor, change nothing.
      return;
  }
}

/**
 * An issue replaces the stored one only when it is at least as fresh. A
 * baseline replays old events after a newer snapshot, and those must not roll
 * the snapshot back.
 */
function upsert(issues: Record<string, Issue>, incoming: Issue): void {
  const current = issues[incoming.id];
  if (current && freshness(incoming) < freshness(current)) {
    return;
  }
  issues[incoming.id] = incoming;
}

function freshness(issue: Issue): number {
  const parsed = Date.parse(issue.updated_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function appendComment(issues: Record<string, Issue>, record: JournalRecord): void {
  const incoming = record.comment;
  const current = issues[record.issue_id];
  if (!incoming || !current) {
    return;
  }
  const existing = current.comments ?? [];
  if (existing.some((comment) => comment.id === incoming.id)) {
    return;
  }
  const comment: Comment = {
    id: incoming.id,
    issue_id: record.issue_id,
    author: incoming.author,
    text: incoming.text,
    created_at: incoming.created_at,
  };
  issues[current.id] = { ...current, comments: [...existing, comment] };
}