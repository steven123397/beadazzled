import type { Issue } from '@/bindings/bd';

import { collator } from '@/lib/view/collator';
import { STATUS_ORDER } from '@/lib/status';
import type { GroupBy } from '@/lib/view/state';

export type IssueGroup = {
  key: string;
  issues: Issue[];
};

/**
 * Groups already-filtered issues without reordering them. The caller keeps the
 * filter → group → sort pipeline: each bucket is rendered and sorted in place.
 */
export function groupIssues(issues: readonly Issue[], group: GroupBy): IssueGroup[] {
  if (group === 'none') {
    return [{ key: '', issues: [...issues] }];
  }

  const buckets = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = groupKey(issue, group);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [issue]);
    } else {
      bucket.push(issue);
    }
  }

  return [...buckets.keys()]
    .sort((left, right) => compareKeys(left, right, group))
    .map((key) => ({ key, issues: buckets.get(key) ?? [] }));
}

function groupKey(issue: Issue, group: Exclude<GroupBy, 'none'>): string {
  switch (group) {
    case 'status':
      return issue.status;
    case 'priority':
      return String(issue.priority);
    case 'type':
      return issue.issue_type;
    case 'assignee':
      return issue.assignee ?? '';
  }
}

function compareKeys(left: string, right: string, group: Exclude<GroupBy, 'none'>): number {
  switch (group) {
    case 'status': {
      const rank = statusRank(left) - statusRank(right);
      return rank !== 0 ? rank : collator.compare(left, right);
    }
    case 'priority':
      return Number(left) - Number(right);
    case 'type':
    case 'assignee': {
      // An empty type or assignee ("unassigned") is a residual bucket, not the
      // first item alphabetically.
      if (left === '') return 1;
      if (right === '') return -1;
      return collator.compare(left, right);
    }
  }
}

function statusRank(status: string): number {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length : index;
}
