import type { Issue } from '@/bindings/bd';
import type { IssueLookup } from '@/lib/issues';

import * as guard from '@/lib/writes/guard';

/**
 * Ids of dependencies that are not closed yet, matching Scotty's
 * `blockingDeps`. A target missing from the store counts as unfinished rather
 * than silently ready.
 */
export function blockingDeps(issue: Issue, lookup: IssueLookup): string[] {
  // Two edges of different types can point at the same ticket; it is still
  // one blocker, matching `lib/writes/guard.blockingDeps`.
  return guard.blockingDeps(issue.dependencies, (id) => lookup(id)?.status);
}

/** Ready means the issue is open and nothing blocking remains. */
export function isReady(issue: Issue, lookup: IssueLookup): boolean {
  return issue.status === 'open' && blockingDeps(issue, lookup).length === 0;
}
