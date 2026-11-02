import type { Issue } from '@/bindings/bd';

import { collator } from '@/lib/view/collator';
import type { ListSort, SortField } from '@/lib/view/state';

/** Returns a new array; the store's issue list is never mutated in place. */
export function sortIssues(issues: readonly Issue[], sort: ListSort): Issue[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  const timestamps = new Map<string, number>();

  return [...issues].sort((left, right) => {
    const compared = compare(left, right, sort.by, timestamps);
    if (compared !== 0) {
      return compared * factor;
    }
    // Stable ties make the rendered list deterministic across runs.
    return collator.compare(left.id, right.id);
  });
}

function compare(
  left: Issue,
  right: Issue,
  field: SortField,
  timestamps: Map<string, number>
): number {
  switch (field) {
    case 'updated':
      return timestamp(left.updated_at, timestamps) - timestamp(right.updated_at, timestamps);
    case 'created':
      return timestamp(left.created_at, timestamps) - timestamp(right.created_at, timestamps);
    case 'priority':
      return left.priority - right.priority;
    case 'title':
      return collator.compare(left.title, right.title);
    case 'id':
      return collator.compare(left.id, right.id);
  }
}

function timestamp(value: string, cache: Map<string, number>): number {
  const cached = cache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = Date.parse(value);
  // Invalid and missing timestamps sort as the oldest entry rather than
  // producing NaN, which would make the comparator unstable.
  const result = Number.isNaN(parsed) ? 0 : parsed;
  cache.set(value, result);
  return result;
}
