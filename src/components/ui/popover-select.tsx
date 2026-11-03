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
  /** `xs` fits inside a property row; `sm` is the top bar, `md` the filters. */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  /** Applied to the summary, for example to stretch it to a fixed width. */
  triggerClassName?: string;
  /** Applied to the summary, so a screen can focus it by id. */
  id?: string;
  disabled?: boolean;
};

/** Each size carries its own height and type scale, so the trigger reads the
 * same as the row it sits in. */
const SIZE_CLASS = {
  xs: 'h-6 px-1.5 text-2xs',
  sm: 'h-control-sm px-2.5 text-sm',
  md: 'h-8 px-2.5 text-sm',
} as const;

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
  triggerClassName,
  id,
  disabled = false,
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
      // Escape closes the menu, not the page behind it. The shell binds its
      // own Escape on window (e.g. back to the list), so the popup has to
      // claim the key before that listener sees it.
      event.preventDefault();
      event.stopPropagation();
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
        id={id}
        aria-label={`${label}: ${selected?.label ?? ''}`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
        className={cn(
          'flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-raised text-foreground shadow-xs',
          SIZE_CLASS[size],
          disabled ? 'pointer-events-none opacity-50' : 'hover:bg-hover',
          triggerClassName
        )}
      >
        <span className="max-w-48 truncate">{selected?.label ?? label}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </summary>
      <div className="thin-scrollbar absolute left-0 top-full z-40 mt-1 max-h-64 w-48 overflow-auto rounded-md border border-border bg-raised p-1 shadow-popover">
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
              disabled={option.disabled === true || disabled}
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
