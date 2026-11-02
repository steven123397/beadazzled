import type { Issue } from '@/bindings/bd';

import { collator } from '@/lib/view/collator';
import { hasActiveFilters, matchesFilter, type FilterContext } from '@/lib/view/filter';
import type { ListFilter } from '@/lib/view/state';
import type { MessageKey } from '@/lib/i18n';
import { blockingDeps } from '@/lib/writes/guard';

/**
 * The board's derived columns. They are a work view over `status +
 * blockingDeps`, not a mirror of the bd status field: an open issue with an
 * unfinished blocker belongs to Blocked, and moves back to Ready by itself when
 * the dependency is closed.
 */
export type ColumnId = 'backlog' | 'ready' | 'in-progress' | 'blocked' | 'done' | 'other';

/** Fixed display order from SPEC-board; `other` is appended only when needed. */
export const COLUMN_ORDER: readonly ColumnId[] = [
  'backlog',
  'ready',
  'in-progress',
  'blocked',
  'done',
  'other',
];

export const COLUMN_LABEL_KEYS: Record<ColumnId, MessageKey> = {
  backlog: 'board.column.backlog',
  ready: 'board.column.ready',
  'in-progress': 'board.column.inProgress',
  blocked: 'board.column.blocked',
  done: 'board.column.done',
  other: 'board.column.other',
};

export type BoardCard = {
  issue: Issue;
  /** Unresolved blocking dependency ids; only Blocked cards render these. */
  blockers: readonly string[];
  /** `status = blocked` by hand, as opposed to being blocked by dependencies. */
  manual: boolean;
};

export type BoardColumn = {
  id: ColumnId;
  cards: readonly BoardCard[];
};

export type BoardModel = {
  columns: readonly BoardColumn[];
  /** Cards after filtering, across all columns. */
  count: number;
};

const NO_BLOCKERS: readonly string[] = [];

/**
 * The single implementation of the column table from SPEC-board. The order of
 * the checks is the table order: Done first, then Blocked, so an open issue
 * with blockers can never leak into Ready.
 */
export function columnOf(issue: Issue, blockers: readonly string[]): ColumnId {
  if (issue.status === 'closed') {
    return 'done';
  }
  if (issue.status === 'blocked' || (issue.status === 'open' && blockers.length > 0)) {
    return 'blocked';
  }
  if (issue.status === 'deferred') {
    return 'backlog';
  }
  if (issue.status === 'in_progress' || issue.status === 'hooked') {
    return 'in-progress';
  }
  if (issue.status === 'open') {
    return 'ready';
  }
  return 'other';
}

/**
 * Partitions issues into columns and sorts each column by priority, then most
 * recently updated. `byId` must contain every issue in the store, not just the
 * filtered set: a blocker outside the current filter still blocks.
 */
export function buildBoard(
  issues: readonly Issue[],
  byId: Readonly<Record<string, Issue>>
): BoardModel {
  const grouped: Record<ColumnId, BoardCard[]> = {
    backlog: [],
    ready: [],
    'in-progress': [],
    blocked: [],
    done: [],
    other: [],
  };
  const statusOf = (id: string): string | undefined =>
    Object.hasOwn(byId, id) ? byId[id]?.status : undefined;

  for (const issue of issues) {
    const blockers = blockingDeps(issue.dependencies, statusOf);
    const column = columnOf(issue, blockers);
    grouped[column].push({
      issue,
      blockers: blockers.length === 0 ? NO_BLOCKERS : blockers,
      manual: issue.status === 'blocked',
    });
  }

  const timestamps = new Map<string, number>();
  const compare = (left: BoardCard, right: BoardCard): number => {
    if (left.issue.priority !== right.issue.priority) {
      return left.issue.priority - right.issue.priority;
    }
    const recency =
      timestamp(right.issue.updated_at, timestamps) - timestamp(left.issue.updated_at, timestamps);
    if (recency !== 0) {
      return recency;
    }
    return collator.compare(left.issue.id, right.issue.id);
  };

  const columns: BoardColumn[] = [];
  for (const id of COLUMN_ORDER) {
    // Other is a diagnostic column: it only appears when it has tickets.
    if (id === 'other' && grouped.other.length === 0) {
      continue;
    }
    grouped[id].sort(compare);
    columns.push({ id, cards: grouped[id] });
  }

  return { columns, count: issues.length };
}

/**
 * Board filters reuse the list's dimensions except status, which the columns
 * already express. A `status` parameter from the URL is ignored here but kept
 * in the URL so switching back to the list still honours it.
 */
export function filterForBoard(
  issues: readonly Issue[],
  filter: ListFilter,
  context: FilterContext = {}
): Issue[] {
  const statusless = withoutStatus(filter);
  return issues.filter((issue) => matchesFilter(issue, statusless, context));
}

/** The filter applies only when a dimension other than status narrows it. */
export function hasBoardFilters(filter: ListFilter): boolean {
  return hasActiveFilters(withoutStatus(filter));
}

function withoutStatus(filter: ListFilter): ListFilter {
  return filter.status.length === 0 ? filter : { ...filter, status: [] };
}

function timestamp(value: string, cache: Map<string, number>): number {
  const cached = cache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = Date.parse(value);
  // Invalid timestamps sort as the oldest rather than producing NaN, which
  // would make the comparator unstable.
  const result = Number.isNaN(parsed) ? 0 : parsed;
  cache.set(value, result);
  return result;
}
