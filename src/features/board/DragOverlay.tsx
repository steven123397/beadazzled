import { DragOverlay } from '@dnd-kit/core';

import type { BoardCard } from './columns';
import { CardBody } from './Card';

/**
 * Exactly one overlay is mounted per drag; it is a presentational copy of the
 * card, so the source column is never re-sorted or re-measured while dragging.
 */
export function BoardDragOverlay({ card }: { card: BoardCard | null }) {
  return (
    <DragOverlay dropAnimation={null}>
      {card === null ? null : (
        <div className="w-72 rotate-1 rounded-md border border-border bg-card p-2 text-xs opacity-95 shadow-md">
          <CardBody card={card} />
        </div>
      )}
    </DragOverlay>
  );
}
