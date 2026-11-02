import type { Dependency, Issue } from '@/bindings/bd';

import { isBlockingDependency } from '@/lib/dependencies';

const BLOCKED_TARGETS = new Set(['in_progress', 'closed']);

export type StatusChangeDecision =
  | { allowed: true }
  | { allowed: false; reason: 'blocked-by-dependencies'; blockers: string[] };

/**
 * The unresolved blockers of an issue, from the dependency edges plus the
 * current status of each target. A target that is not in the store counts as
 * unresolved.
 */
export function blockingDeps(
  dependencies: readonly Dependency[] | undefined,
  statusOf: (id: string) => string | undefined
): string[] {
  const blockers: string[] = [];
  for (const dependency of dependencies ?? []) {
    if (!isBlockingDependency(dependency.type)) {
      continue;
    }
    if (statusOf(dependency.depends_on_id) === 'closed') {
      continue;
    }
    if (!blockers.includes(dependency.depends_on_id)) {
      blockers.push(dependency.depends_on_id);
    }
  }
  return blockers;
}

/**
 * The single status guard shared by board drags, keyboard moves and the detail
 * menu. Moving into `in_progress` or `closed` while a blocker is unresolved is
 * refused; every other target is allowed.
 */
export function canChangeStatus(
  issue: Pick<Issue, 'status' | 'dependencies'>,
  target: string,
  unresolvedBlockers: readonly string[]
): StatusChangeDecision {
  if (unresolvedBlockers.length === 0 || target === issue.status) {
    return { allowed: true };
  }
  if (!BLOCKED_TARGETS.has(target)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'blocked-by-dependencies',
    blockers: [...unresolvedBlockers],
  };
}