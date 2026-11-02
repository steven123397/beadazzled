import { parseListViewState, serializeListViewState, type ListViewState } from './state';

/** Per-workspace list view, remembered across restarts. */
export const LIST_VIEW_PREFIX = 'beadazzled.list.view.';

export function loadSavedView(projectId: string, storage?: Storage): ListViewState | null {
  try {
    const store = storage ?? window.localStorage;
    const raw = store.getItem(`${LIST_VIEW_PREFIX}${projectId}`);
    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isListViewState(parsed)) {
      return null;
    }
    // Round-trip through the URL codec so unknown values are normalized by the
    // same rules a deep link uses.
    return parseListViewState(new URLSearchParams(serializeListViewState(parsed)));
  } catch {
    return null;
  }
}

export function saveSavedView(projectId: string, view: ListViewState, storage?: Storage): void {
  try {
    const store = storage ?? window.localStorage;
    store.setItem(`${LIST_VIEW_PREFIX}${projectId}`, JSON.stringify(view));
  } catch {
    // The list still works; only the next launch starts from the defaults.
  }
}

function isListViewState(value: unknown): value is ListViewState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const filter = record.filter;
  if (typeof filter !== 'object' || filter === null) {
    return false;
  }
  const candidate = filter as Record<string, unknown>;

  return (
    typeof candidate.query === 'string' &&
    isStringArray(candidate.status) &&
    isNumberArray(candidate.priority) &&
    isStringArray(candidate.type) &&
    isStringArray(candidate.assignee) &&
    isStringArray(candidate.label) &&
    typeof candidate.ready === 'boolean' &&
    typeof record.group === 'string' &&
    isSort(record.sort)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function isSort(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const sort = value as Record<string, unknown>;
  return typeof sort.by === 'string' && (sort.direction === 'asc' || sort.direction === 'desc');
}
