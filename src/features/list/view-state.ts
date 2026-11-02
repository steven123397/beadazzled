/** List filtering, grouping and sorting state, plus its URL representation. */

export type GroupBy = 'none' | 'status' | 'priority' | 'type' | 'assignee';

export type SortField = 'updated' | 'priority' | 'created' | 'title' | 'id';

export type SortDirection = 'asc' | 'desc';

export type ListFilter = {
  /** Matched against id, title and labels only; body search is out of scope. */
  query: string;
  status: string[];
  priority: number[];
  type: string[];
  /** `''` stands for the unassigned bucket. */
  assignee: string[];
  label: string[];
  ready: boolean;
};

export type ListSort = {
  by: SortField;
  direction: SortDirection;
};

export type ListViewState = {
  filter: ListFilter;
  group: GroupBy;
  sort: ListSort;
};

export const GROUP_VALUES: readonly GroupBy[] = ['none', 'status', 'priority', 'type', 'assignee'];

export const SORT_FIELDS: readonly SortField[] = ['updated', 'priority', 'created', 'title', 'id'];

/** Direction used when a URL names a sort field without one. */
export const DEFAULT_SORT_DIRECTION: Record<SortField, SortDirection> = {
  updated: 'desc',
  created: 'desc',
  priority: 'asc',
  title: 'asc',
  id: 'asc',
};

const KNOWN_KEYS = new Set([
  'q',
  'status',
  'priority',
  'type',
  'assignee',
  'label',
  'group',
  'sort',
  'ready',
]);

const DIRECTIONS = new Set<SortDirection>(['asc', 'desc']);
const FIELDS = new Set<SortField>(SORT_FIELDS);
const GROUPS = new Set<GroupBy>(GROUP_VALUES);

export function createListViewState(): ListViewState {
  return {
    filter: {
      query: '',
      status: [],
      priority: [],
      type: [],
      assignee: [],
      label: [],
      ready: false,
    },
    group: 'none',
    sort: { by: 'updated', direction: 'desc' },
  };
}

/** True when the URL carries at least one known list-state key. */
export function hasViewParams(params: URLSearchParams): boolean {
  for (const key of KNOWN_KEYS) {
    // `?q=` is what an emptied search box leaves behind; it is not a view.
    if (key === 'q') {
      if ((params.get('q') ?? '').trim() !== '') {
        return true;
      }
      continue;
    }
    if (params.has(key)) {
      return true;
    }
  }
  return false;
}

/** Unknown keys and values fall back to defaults so old links keep working. */
export function parseListViewState(params: URLSearchParams): ListViewState {
  return {
    filter: {
      query: params.get('q') ?? '',
      status: nonEmpty(params.getAll('status')),
      priority: numbers(params.getAll('priority')),
      type: nonEmpty(params.getAll('type')),
      // An empty assignee value is meaningful: it selects "unassigned".
      assignee: unique(params.getAll('assignee')),
      label: nonEmpty(params.getAll('label')),
      ready: params.get('ready') === '1' || params.get('ready') === 'true',
    },
    group: parseGroup(params.get('group')),
    sort: parseSort(params.get('sort')),
  };
}

/**
 * Writes the view state to URL parameters. Keys this module does not know are
 * copied through: a newer version may have added a view option, and an older
 * build must not erase it while the user navigates.
 */
export function serializeListViewState(
  view: ListViewState,
  params: URLSearchParams = new URLSearchParams()
): URLSearchParams {
  const known = new URLSearchParams();
  // Keep the raw value: the search box is controlled by what this function
  // writes, so trimming here would eat every space as the user types it.
  const query = view.filter.query;

  if (query.trim() !== '') {
    known.set('q', query);
  }
  for (const value of view.filter.status) {
    if (value !== '') {
      known.append('status', value);
    }
  }
  for (const value of view.filter.priority) {
    known.append('priority', String(value));
  }
  for (const value of view.filter.type) {
    if (value !== '') {
      known.append('type', value);
    }
  }
  for (const value of view.filter.assignee) {
    known.append('assignee', value);
  }
  for (const value of view.filter.label) {
    if (value !== '') {
      known.append('label', value);
    }
  }
  if (view.group !== 'none') {
    known.set('group', view.group);
  }
  if (view.sort.by !== 'updated' || view.sort.direction !== 'desc') {
    known.set('sort', `${view.sort.by}:${view.sort.direction}`);
  }
  if (view.filter.ready) {
    known.set('ready', '1');
  }

  const result = new URLSearchParams(known);
  for (const [key, value] of params) {
    if (!KNOWN_KEYS.has(key)) {
      result.append(key, value);
    }
  }
  return result;
}

function parseGroup(value: string | null): GroupBy {
  return value !== null && GROUPS.has(value as GroupBy) ? (value as GroupBy) : 'none';
}

/**
 * Accepts `field:direction`, `field` (field default direction) and `-field`
 * (the opposite of the field default). Unknown fields fall back to `updated`.
 */
function parseSort(value: string | null): ListSort {
  if (value === null) {
    return { by: 'updated', direction: 'desc' };
  }

  const [rawField = '', rawDirection] = value.split(':');
  const descending = rawField.startsWith('-');
  const field = descending ? rawField.slice(1) : rawField;

  if (!FIELDS.has(field as SortField)) {
    return { by: 'updated', direction: 'desc' };
  }

  const by = field as SortField;
  const direction: SortDirection =
    rawDirection !== undefined && DIRECTIONS.has(rawDirection as SortDirection)
      ? (rawDirection as SortDirection)
      : descending
        ? opposite(DEFAULT_SORT_DIRECTION[by])
        : DEFAULT_SORT_DIRECTION[by];

  return { by, direction };
}

function opposite(direction: SortDirection): SortDirection {
  return direction === 'asc' ? 'desc' : 'asc';
}

function nonEmpty(values: readonly string[]): string[] {
  return unique(values.filter((value) => value !== ''));
}

function numbers(values: readonly string[]): number[] {
  const parsed: number[] = [];
  for (const value of values) {
    // `?priority=` produces an empty string; Number('') is 0, which would
    // silently filter the list to P0.
    const trimmed = value.trim();
    if (trimmed === '') {
      continue;
    }
    const number = Number(trimmed);
    // bd priorities are 0-4; anything else is a stale or hand-written link.
    if (Number.isInteger(number) && number >= 0 && number <= 4) {
      parsed.push(number);
    }
  }
  return unique(parsed);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
