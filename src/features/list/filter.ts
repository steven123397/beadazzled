import type { Issue } from '@/bindings/bd';

import { indexById, matchesFilter, type FilterContext } from '@/lib/view/filter';
import type { ListViewState } from '@/lib/view/state';

import { sortIssues } from './sort';

/** Filters first, then sorts; grouping is applied to the result by the view. */
export function selectVisibleIssues(
  issues: readonly Issue[],
  view: ListViewState,
  context: FilterContext = {}
): Issue[] {
  const readyContext =
    view.filter.ready && context.issuesById === undefined
      ? { ...context, issuesById: indexById(issues) }
      : context;

  const visible = issues.filter((issue) => matchesFilter(issue, view.filter, readyContext));
  return sortIssues(visible, view.sort);
}
