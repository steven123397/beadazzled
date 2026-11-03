import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export type PopoverSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type PopoverSelectProps = {
  label: string;
  value: string;
  options: readonly PopoverSelectOption[];
  onChange: (next: string) => void;
  /** `sm` keeps the top bar compact; `md` matches the 32px filter controls. */
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * A single-choice dropdown with the same rounded surface as the filter
 * popovers. It replaces the native `<select>` where the OS-drawn square popup
 * and the click-time focus ring would break the shared visual language.
 */
export function PopoverSelect({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className,
}: PopoverSelectProps) {
  const name = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // The URL round-trip is asynchronous. Keeping the choice locally makes the
  // radio check on the same click, instead of snapping back during the render
  // that still carries the previous value.
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    setCurrent(value);
  }, [value]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      const details = detailsRef.current;
      if (
        details?.open === true &&
        event.target instanceof Node &&
        !details.contains(event.target)
      ) {
        details.open = false;
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      const details = detailsRef.current;
      if (event.key !== 'Escape' || details?.open !== true) {
        return;
      }
      details.open = false;
      details.querySelector('summary')?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const selected = options.find((option) => option.value === current);

  return (
    <details aria-label={label} ref={detailsRef} className={cn('relative inline-flex', className)}>
      <summary
        aria-label={`${label}: ${selected?.label ?? ''}`}
        className={cn(
          'flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm text-foreground shadow-xs hover:bg-hover',
          size === 'sm' ? 'h-control-sm' : 'h-8'
        )}
      >
        <span className="max-w-48 truncate">{selected?.label ?? label}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </summary>
      <div className="thin-scrollbar absolute left-0 z-40 mt-1 max-h-64 w-48 overflow-auto rounded-md border border-border bg-card p-1 shadow-popover">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
              option.disabled === true
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer hover:bg-hover'
            )}
          >
            <input
              type="radio"
              name={name}
              className="size-4"
              disabled={option.disabled}
              checked={option.value === current}
              onChange={(event) => {
                if (option.disabled === true) {
                  return;
                }
                setCurrent(option.value);
                onChange(option.value);
                const details = event.currentTarget.closest('details');
                if (details !== null) {
                  details.open = false;
                }
              }}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
