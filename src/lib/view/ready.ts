import type { Issue } from '@/bindings/bd';

import { isBlockingDependency } from '@/lib/dependencies';

/** Resolves a dependency target; a missing id means "not in the store". */
export type IssueLookup = (id: string) => Issue | undefined;

/**
 * Ids of dependencies that are not closed yet, matching Scotty's
 * `blockingDeps`. A target missing from the store counts as unfinished rather
 * than silently ready.
 */
export function blockingDeps(issue: Issue, lookup: IssueLookup): string[] {
  return (issue.dependencies ?? [])
    .filter((dependency) => isBlockingDependency(dependency.type))
    .filter((dependency) => lookup(dependency.depends_on_id)?.status !== 'closed')
    .map((dependency) => dependency.depends_on_id);
}

/** Ready means the issue is open and nothing blocking remains. */
export function isReady(issue: Issue, lookup: IssueLookup): boolean {
  return issue.status === 'open' && blockingDeps(issue, lookup).length === 0;
}
