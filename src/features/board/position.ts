/** Per-workspace board position, kept for the session so returning from detail
 * restores each column's scroll offset and the focused card. */

export const BOARD_POSITION_PREFIX = 'beadazzled.board.position.';

export type BoardPosition = {
  focusedId: string | null;
  /** Scroll offset per column id; a missing column starts at the top. */
  scroll: Record<string, number>;
};

/** A missing, malformed or unreadable position means "start at the top". */
export function loadBoardPosition(projectId: string, storage?: Storage): BoardPosition | null {
  try {
    const store = storage ?? window.sessionStorage;
    const raw = store.getItem(`${BOARD_POSITION_PREFIX}${projectId}`);
    if (raw === null) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const { focusedId, scroll } = parsed as Record<string, unknown>;
    if (focusedId !== undefined && focusedId !== null && typeof focusedId !== 'string') {
      return null;
    }
    if (typeof scroll !== 'object' || scroll === null || Array.isArray(scroll)) {
      return null;
    }

    const offsets: Record<string, number> = {};
    for (const [columnId, value] of Object.entries(scroll)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
      }
      offsets[columnId] = value;
    }

    return { focusedId: typeof focusedId === 'string' ? focusedId : null, scroll: offsets };
  } catch {
    return null;
  }
}

/** Best-effort write: losing a scroll offset is preferable to a crash. */
export function saveBoardPosition(
  projectId: string,
  position: BoardPosition,
  storage?: Storage
): void {
  try {
    const store = storage ?? window.sessionStorage;
    store.setItem(`${BOARD_POSITION_PREFIX}${projectId}`, JSON.stringify(position));
  } catch {
    // The board still works; only the next return starts at the top.
  }
}
