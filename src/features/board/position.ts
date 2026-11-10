import { loadPosition, savePosition } from '@/lib/session-position';

/** Per-workspace board position, kept for the session so returning from detail
 * restores each column's scroll offset and the focused card. */

export const BOARD_POSITION_PREFIX = 'beadazzled.board.position.';

export type BoardPosition = {
  focusedId: string | null;
  /** Scroll offset per column id; a missing column starts at the top. */
  scroll: Record<string, number>;
};

export function loadBoardPosition(projectId: string, storage?: Storage): BoardPosition | null {
  return loadPosition(projectId, BOARD_POSITION_PREFIX, decodeBoardPosition, storage);
}

export function saveBoardPosition(
  projectId: string,
  position: BoardPosition,
  storage?: Storage
): void {
  savePosition(projectId, BOARD_POSITION_PREFIX, position, storage);
}

function decodeBoardPosition(parsed: unknown): BoardPosition | null {
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
}
