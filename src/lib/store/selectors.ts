import type { Issue } from '@/bindings/bd';

import { isBlockingDependency } from '@/lib/dependencies';
import { emptyRecord } from '@/lib/sync/reducer';

/**
 * A dependency target. `issue` is undefined when the target is not in the
 * store (deleted, or filtered out by the journal): the detail page still shows
 * the id and labels it "not found".
 */
export type IssueRef = { id: string; issue: Issue | undefined };

/** One reverse edge: who points at this id, and with which relation. */
export type DependentEdge = { id: string; type: string };

export type IssueIndex = {
  byId: Record<string, Issue>;
  /** Reverse edges: target id -> issues that depend on it, with the relation. */
  dependents: Record<string, DependentEdge[]>;
};

/**
 * Builds the lookup the detail page needs. Kept separate from rendering so a
 * mount builds it once per snapshot instead of rescanning all tickets per
 * section.
 */
export function indexIssues(issues: readonly Issue[]): IssueIndex {
  const byId = emptyRecord<Issue>();
  const dependents = emptyRecord<DependentEdge[]>();

  for (const issue of issues) {
    byId[issue.id] = issue;
    for (const dependency of issue.dependencies ?? []) {
      (dependents[dependency.depends_on_id] ??= []).push({
        id: issue.id,
        type: dependency.type,
      });
    }
  }

  return { byId, dependents };
}

export function getIssue(index: IssueIndex, id: string): Issue | undefined {
  return index.byId[id];
}

/**
 * The issues this one is blocked by, in the order bd reported the edges. Only
 * blocking relations count: `parent-child` and `related` must not show up
 * here, or the list would contradict the status guard.
 */
export function getBlockedBy(index: IssueIndex, id: string): IssueRef[] {
  const issue = index.byId[id];
  if (issue === undefined) {
    return [];
  }

  const seen = new Set<string>();
  const refs: IssueRef[] = [];
  for (const dependency of issue.dependencies ?? []) {
    if (!isBlockingDependency(dependency.type)) {
      continue;
    }
    const target = dependency.depends_on_id;
    if (seen.has(target)) {
      continue;
    }
    seen.add(target);
    refs.push({ id: target, issue: index.byId[target] });
  }
  return refs;
}

/** The issues this one blocks, sorted by id for a stable list. */
export function getBlocks(index: IssueIndex, id: string): IssueRef[] {
  const edges = (index.dependents[id] ?? []).filter((edge) => isBlockingDependency(edge.type));
  const ids = [...new Set(edges.map((edge) => edge.id))].sort((left, right) =>
    left.localeCompare(right)
  );
  return ids.map((target) => ({ id: target, issue: index.byId[target] }));
}
