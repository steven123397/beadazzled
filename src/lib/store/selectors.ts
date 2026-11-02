import type { Issue } from '@/bindings/bd';

import { emptyRecord } from '@/lib/sync/reducer';

/**
 * A dependency target. `issue` is undefined when the target is not in the
 * store (deleted, or filtered out by the journal): the detail page still shows
 * the id and labels it "not found".
 */
export type IssueRef = { id: string; issue: Issue | undefined };

export type IssueIndex = {
  byId: Record<string, Issue>;
  /** Reverse edges: target id -> ids of issues that depend on it. */
  dependents: Record<string, string[]>;
};

/**
 * Builds the lookup the detail page needs. Kept separate from rendering so a
 * mount builds it once per snapshot instead of rescanning all tickets per
 * section.
 */
export function indexIssues(issues: readonly Issue[]): IssueIndex {
  const byId = emptyRecord<Issue>();
  const dependents = emptyRecord<string[]>();

  for (const issue of issues) {
    byId[issue.id] = issue;
    for (const dependency of issue.dependencies ?? []) {
      (dependents[dependency.depends_on_id] ??= []).push(issue.id);
    }
  }

  return { byId, dependents };
}

export function getIssue(index: IssueIndex, id: string): Issue | undefined {
  return index.byId[id];
}

/** The issues this one depends on, in the order bd reported the edges. */
export function getBlockedBy(index: IssueIndex, id: string): IssueRef[] {
  const issue = index.byId[id];
  if (issue === undefined) {
    return [];
  }

  const seen = new Set<string>();
  const refs: IssueRef[] = [];
  for (const dependency of issue.dependencies ?? []) {
    const target = dependency.depends_on_id;
    if (seen.has(target)) {
      continue;
    }
    seen.add(target);
    refs.push({ id: target, issue: index.byId[target] });
  }
  return refs;
}

/** The issues that depend on this one, sorted by id for a stable list. */
export function getBlocks(index: IssueIndex, id: string): IssueRef[] {
  const ids = index.dependents[id] ?? [];
  return [...new Set(ids)]
    .sort((left, right) => left.localeCompare(right))
    .map((target) => ({ id: target, issue: index.byId[target] }));
}