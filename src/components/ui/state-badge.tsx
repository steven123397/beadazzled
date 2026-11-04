import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The quiet mark above an empty, no-match or error explanation. Shared by the
 * list and board state screens so the two surfaces read the same.
 */
export function StateBadge({
  icon,
  tone = 'muted',
}: {
  icon: ReactNode;
  tone?: 'muted' | 'danger';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-9 items-center justify-center rounded-full',
        tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
      )}
    >
      {icon}
    </span>
  );
}
