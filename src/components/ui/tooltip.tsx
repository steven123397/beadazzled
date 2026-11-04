import { cloneElement, useId, useRef, useState, type ReactElement } from 'react';

import { cn } from '@/lib/utils';

export type TooltipProps = {
  label: string;
  /** Where the bubble sits relative to the trigger. */
  side?: 'bottom' | 'right';
  delayMs?: number;
  /** Applied to the wrapper; use `block w-full` for full-width children. */
  className?: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
};

/**
 * A hover/focus hint. It is deliberately small: no collision detection, so a
 * trigger at the very edge of the window can clip its bubble. Every current
 * use is a sidebar or toolbar control with room around it.
 */
export function Tooltip({
  label,
  side = 'bottom',
  delayMs = 400,
  className,
  children,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setVisible(true), delayMs);
  };

  const hide = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setVisible(false);
  };

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          hide();
        }
      }}
    >
      {cloneElement(children, { 'aria-describedby': visible ? id : undefined })}
      {visible ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute z-40 whitespace-nowrap rounded-sm border border-border bg-raised px-1.5 py-0.5 text-2xs text-foreground shadow-sm',
            side === 'right'
              ? 'left-full top-1/2 ml-2 -translate-y-1/2'
              : 'left-1/2 top-full mt-1 -translate-x-1/2'
          )}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
