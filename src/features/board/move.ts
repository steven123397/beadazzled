import type { Issue, WriteCommand } from '@/bindings/bd';

import { closeIssue, updateIssue } from '@/lib/writes/commands';
import { canChangeStatus } from '@/lib/writes/guard';

import type { ColumnId } from './columns';

/** Columns that accept a drop; Blocked and Other are read-only views. */
export const DROPPABLE_ORDER: readonly ColumnId[] = ['backlog', 'ready', 'in-progress', 'done'];

const DROPPABLE = new Set<ColumnId>(DROPPABLE_ORDER);

export function isDroppableColumn(id: ColumnId): boolean {
  return DROPPABLE.has(id);
}

export type MoveRejection =
  | { reason: 'same-column' }
  | { reason: 'source-blocked' }
  | { reason: 'target-not-droppable'; column: ColumnId }
  | { reason: 'ready-blocked'; blockers: readonly string[] }
  | { reason: 'blocked-by-dependencies'; blockers: readonly string[] }
  | { reason: 'invalid-command' };

export type MovePlan =
  | { ok: true; commands: readonly WriteCommand[]; targetStatus: string }
  | { ok: false; rejection: MoveRejection };

type MovableIssue = Pick<Issue, 'id' | 'status' | 'dependencies'>;

const TARGET_STATUS: Partial<Record<ColumnId, string>> = {
  backlog: 'deferred',
  ready: 'open',
  'in-progress': 'in_progress',
  done: 'closed',
};

/**
 * Maps a drop or keyboard move to the exact bd command sequence from
 * SPEC-board. Pure: the caller supplies the source and target derived columns
 * and the issue's unresolved blockers, so drag and keyboard cannot diverge.
 */
export function planMove(
  issue: MovableIssue,
  source: ColumnId,
  target: ColumnId,
  blockers: readonly string[]
): MovePlan {
  if (source === target) {
    return { ok: false, rejection: { reason: 'same-column' } };
  }
  if (source === 'blocked') {
    return { ok: false, rejection: { reason: 'source-blocked' } };
  }
  if (!isDroppableColumn(target)) {
    return { ok: false, rejection: { reason: 'target-not-droppable', column: target } };
  }

  const targetStatus = TARGET_STATUS[target];
  if (targetStatus === undefined) {
    return { ok: false, rejection: { reason: 'invalid-command' } };
  }

  // A corrupt/empty status would serialize as `--if-status ""`, which bd may
  // read as "no guard". Refuse the move instead of writing unguarded.
  if (issue.status.trim() === '') {
    return { ok: false, rejection: { reason: 'invalid-command' } };
  }

  // Ready is derived as open + no blockers. Writing open while blockers remain
  // would leave the card in Blocked: a drop that looks like it did nothing.
  if (target === 'ready' && blockers.length > 0) {
    return { ok: false, rejection: { reason: 'ready-blocked', blockers } };
  }

  const decision = canChangeStatus(issue, targetStatus, blockers);
  if (!decision.allowed) {
    return {
      ok: false,
      rejection: { reason: 'blocked-by-dependencies', blockers: decision.blockers },
    };
  }

  const commands = buildCommands(issue, targetStatus, target);
  if (commands === null) {
    return { ok: false, rejection: { reason: 'invalid-command' } };
  }
  return { ok: true, commands, targetStatus };
}

function buildCommands(
  issue: MovableIssue,
  targetStatus: string,
  target: ColumnId
): WriteCommand[] | null {
  if (target === 'done') {
    return [closeIssue(issue.id)];
  }

  // A closed issue cannot change status directly; bd needs reopen first, then
  // the target status with the post-reopen `open` as its guard.
  if (issue.status === 'closed') {
    const reopen: WriteCommand = { Reopen: { id: issue.id } };
    if (targetStatus === 'open') {
      return [reopen];
    }
    const update = updateIssue(issue.id, { status: targetStatus, ifStatus: 'open' });
    return update.ok ? [reopen, update.command] : null;
  }

  const update = updateIssue(issue.id, { status: targetStatus, ifStatus: issue.status });
  return update.ok ? [update.command] : null;
}

/**
 * The next droppable column in a direction, skipping Blocked and Other.
 * Returns null at the edge of the fixed order.
 */
export function adjacentDroppableColumn(
  source: ColumnId,
  direction: 'left' | 'right'
): ColumnId | null {
  // Other sits after Done; from there, left reaches Done and right has none.
  const position = source === 'other' ? DROPPABLE_ORDER.length : DROPPABLE_ORDER.indexOf(source);
  if (position === -1) {
    return null;
  }
  const next = direction === 'left' ? position - 1 : position + 1;
  return DROPPABLE_ORDER[next] ?? null;
}
