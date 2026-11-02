/** Per-workspace list position, kept for the session so returning from detail
 * restores both the scroll offset and the focused row. */

export const LIST_POSITION_PREFIX = 'beadazzled.list.position.';

export type ListPosition = {
  scrollTop: number;
  focusedId: string | null;
};

/** A missing, malformed or unreadable position means "start at the top". */
export function loadListPosition(projectId: string, storage?: Storage): ListPosition | null {
  try {
    const store = storage ?? window.sessionStorage;
    const raw = store.getItem(`${LIST_POSITION_PREFIX}${projectId}`);
    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const { scrollTop, focusedId } = parsed as Record<string, unknown>;
    if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop) || scrollTop < 0) {
      return null;
    }
    if (focusedId !== undefined && focusedId !== null && typeof focusedId !== 'string') {
      return null;
    }

    return { scrollTop, focusedId: typeof focusedId === 'string' ? focusedId : null };
  } catch {
    return null;
  }
}

/** Best-effort write: losing a scroll offset is preferable to a crash. */
export function saveListPosition(
  projectId: string,
  position: ListPosition,
  storage?: Storage
): void {
  try {
    const store = storage ?? window.sessionStorage;
    store.setItem(`${LIST_POSITION_PREFIX}${projectId}`, JSON.stringify(position));
  } catch {
    // The list still works; only the next return starts at the top.
  }
}
