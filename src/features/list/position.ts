import { loadPosition, savePosition } from '@/lib/session-position';

/** Per-workspace list position, kept for the session so returning from detail
 * restores both the scroll offset and the focused row. */

export const LIST_POSITION_PREFIX = 'beadazzled.list.position.';

export type ListPosition = {
  scrollTop: number;
  focusedId: string | null;
};

export function loadListPosition(projectId: string, storage?: Storage): ListPosition | null {
  return loadPosition(projectId, LIST_POSITION_PREFIX, decodeListPosition, storage);
}

export function saveListPosition(
  projectId: string,
  position: ListPosition,
  storage?: Storage
): void {
  savePosition(projectId, LIST_POSITION_PREFIX, position, storage);
}

function decodeListPosition(parsed: unknown): ListPosition | null {
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
}
