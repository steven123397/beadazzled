import type { Issue } from '@/bindings/bd';

import type { ListSort, SortField } from './view-state';

/** Deterministic, locale-stable ordering for ids and titles. */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Returns a new array; the store's issue list is never mutated in place. */
export function sortIssues(issues: readonly Issue[], sort: ListSort): Issue[] {
  const factor = sort.direction === 'asc' ? 1 : -1;

  return [...issues].sort((left, right) => {
    const compared = compare(left, right, sort.by);
    if (compared !== 0) {
      return compared * factor;
    }
    // Stable ties make the rendered list deterministic across runs.
    return collator.compare(left.id, right.id);
  });
}

function compare(left: Issue, right: Issue, field: SortField): number {
  switch (field) {
    case 'updated':
      return timestamp(left.updated_at) - timestamp(right.updated_at);
    case 'created':
      return timestamp(left.created_at) - timestamp(right.created_at);
    case 'priority':
      return left.priority - right.priority;
    case 'title':
      return collator.compare(left.title, right.title);
    case 'id':
      return collator.compare(left.id, right.id);
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  // Invalid and missing timestamps sort as the oldest entry rather than
  // producing NaN, which would make the comparator unstable.
  return Number.isNaN(parsed) ? 0 : parsed;
}
