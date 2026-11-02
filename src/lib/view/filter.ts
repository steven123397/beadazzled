import type { Issue } from '@/bindings/bd';

import type { ListFilter } from './state';
import { isReady, type IssueLookup } from './ready';

export type FilterContext = {
  /**
   * Lower-cased id/title/label text, keyed by issue id. Callers build this once
   * per data change so typing in the search box never rescans every issue;
   * callers may omit it and pay for the scan.
   */
  searchText?: ReadonlyMap<string, string>;
  /** Complete issue lookup used by the Ready filter; defaults to the input. */
  issuesById?: Readonly<Record<string, Issue>>;
};

/** The text a v0.1.0 search matches: id, title and labels, lower-cased. */
export function issueSearchText(issue: Issue): string {
  return `${issue.id} ${issue.title} ${issue.labels.join(' ')}`.toLowerCase();
}

/** Indexes an issue list once; reuse it across query edits. */
export function buildSearchIndex(issues: readonly Issue[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const issue of issues) {
    index.set(issue.id, issueSearchText(issue));
  }
  return index;
}

/** True when any filter dimension would narrow the view. */
export function hasActiveFilters(filter: ListFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.status.length > 0 ||
    filter.priority.length > 0 ||
    filter.type.length > 0 ||
    filter.assignee.length > 0 ||
    filter.label.length > 0 ||
    filter.ready
  );
}

/**
 * Dimensions combine with AND; values inside one dimension combine with OR.
 * That is what the multi-select controls in SPEC-list mean.
 */
export function matchesFilter(
  issue: Issue,
  filter: ListFilter,
  context: FilterContext = {}
): boolean {
  const query = filter.query.trim().toLowerCase();
  if (query !== '') {
    const text = context.searchText?.get(issue.id) ?? issueSearchText(issue);
    if (!text.includes(query)) {
      return false;
    }
  }

  if (filter.status.length > 0 && !filter.status.includes(issue.status)) {
    return false;
  }
  if (filter.priority.length > 0 && !filter.priority.includes(issue.priority)) {
    return false;
  }
  if (filter.type.length > 0 && !filter.type.includes(issue.issue_type)) {
    return false;
  }
  if (filter.assignee.length > 0 && !filter.assignee.includes(issue.assignee ?? '')) {
    return false;
  }
  if (filter.label.length > 0 && !issue.labels.some((label) => filter.label.includes(label))) {
    return false;
  }
  if (filter.ready && !isReady(issue, lookupFrom(context.issuesById))) {
    return false;
  }

  return true;
}

/** A lookup that tolerates missing ids and never resolves through the prototype. */
export function lookupFrom(byId: Readonly<Record<string, Issue>> | undefined): IssueLookup {
  if (byId === undefined) {
    return () => undefined;
  }
  // Untrusted ids such as `__proto__` must not resolve through the prototype.
  return (id) => (Object.hasOwn(byId, id) ? byId[id] : undefined);
}

/** Builds the Ready filter's lookup from the full issue list. */
export function indexById(issues: readonly Issue[]): Readonly<Record<string, Issue>> {
  const byId = Object.create(null) as Record<string, Issue>;
  for (const issue of issues) {
    byId[issue.id] = issue;
  }
  return byId;
}
