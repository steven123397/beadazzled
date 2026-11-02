import {
  Circle,
  CircleCheck,
  CircleDot,
  CirclePause,
  CircleSlash,
  Link2,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

type IconComponent = ComponentType<LucideProps>;

/**
 * How each status reads at a glance. Unknown statuses from a newer bd fall
 * back to the plain circle rather than disappearing.
 */
const STATUS_ICONS: Record<string, { Icon: IconComponent; tone: string }> = {
  open: { Icon: Circle, tone: 'text-muted-foreground' },
  in_progress: { Icon: CircleDot, tone: 'text-warning' },
  blocked: { Icon: CircleSlash, tone: 'text-destructive' },
  deferred: { Icon: CirclePause, tone: 'text-muted-foreground' },
  closed: { Icon: CircleCheck, tone: 'text-success' },
  pinned: { Icon: CircleDot, tone: 'text-primary' },
  hooked: { Icon: Link2, tone: 'text-primary' },
};

const FALLBACK = { Icon: Circle, tone: 'text-muted-foreground' };

export type StatusIconProps = {
  status: string;
  /** Accessible name; omit when a visible label sits next to the icon. */
  label?: string;
  className?: string;
};

export function StatusIcon({ status, label, className }: StatusIconProps) {
  const { Icon, tone } = STATUS_ICONS[status] ?? FALLBACK;
  return (
    <Icon
      aria-hidden={label === undefined ? 'true' : undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
      className={cn('size-3.5 shrink-0', tone, className)}
    />
  );
}
