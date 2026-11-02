import { cn } from '@/lib/utils';

const LEVELS = [1, 2, 3] as const;

export type PriorityIconProps = {
  /** bd priorities run 0 (most urgent) to 4 (lowest). */
  priority: number;
  label?: string;
  className?: string;
};

/**
 * Three rising bars, the same shape Linear uses: the number of filled bars is
 * the priority, and 0 (urgent) colours the whole icon instead of filling one
 * more bar.
 */
export function PriorityIcon({ priority, label, className }: PriorityIconProps) {
  const urgent = priority <= 0;
  const filled = urgent ? 3 : Math.max(0, 4 - priority);

  return (
    <svg
      viewBox="0 0 14 14"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? 'true' : undefined}
      className={cn(
        'size-3.5 shrink-0',
        urgent
          ? 'text-destructive'
          : filled === 0
            ? 'text-muted-foreground/60'
            : 'text-muted-foreground',
        className
      )}
    >
      {LEVELS.map((level) => (
        <rect
          key={level}
          x={level * 4 - 3}
          y={11 - level * 3}
          width="2.5"
          height={level * 3 + 1}
          rx="0.75"
          fill="currentColor"
          opacity={level <= filled ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}
