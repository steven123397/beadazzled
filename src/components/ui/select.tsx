import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export type SelectProps = ComponentProps<'select'>;

/**
 * A native select dressed with the shared tokens. The OS draws the popup, so
 * keyboard, touch and screen-reader behaviour stay correct for free.
 */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <span className="relative inline-flex min-w-0 items-center">
      <select
        className={cn(
          'h-control-sm w-full min-w-0 cursor-pointer appearance-none rounded-md border border-transparent bg-transparent py-0 pl-1 pr-5 text-xs text-foreground hover:bg-hover focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-1 size-3 text-muted-foreground"
      />
    </span>
  );
}
