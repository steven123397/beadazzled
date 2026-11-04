import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';

import { buttonVariants } from './button';

export type MenuItemSpec = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export type MenuProps = {
  /** Accessible name of the menu itself. */
  label: string;
  /** Content of the trigger button (normally an icon). */
  trigger: ReactNode;
  items: readonly MenuItemSpec[];
  align?: 'start' | 'end';
  className?: string;
};

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

/**
 * A small menu button: no positioning engine, no portal. It keeps the parts
 * that are easy to get wrong — arrow-key movement, Escape returning focus to
 * the trigger, and closing on an outside press.
 */
export function Menu({ label, trigger, items, align = 'start', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) === true ||
        triggerRef.current?.contains(target) === true
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (entries.length === 0) {
      return;
    }
    const current = entries.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        entries[(current + 1) % entries.length].focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        entries[(current - 1 + entries.length) % entries.length].focus();
        break;
      case 'Home':
        event.preventDefault();
        entries[0].focus();
        break;
      case 'End':
        event.preventDefault();
        entries[entries.length - 1].focus();
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <span className={cn('relative inline-flex', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
          }
          event.preventDefault();
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute top-full z-40 mt-1 min-w-40 rounded-md border border-border bg-raised p-1 shadow-popover',
            align === 'end' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                close(true);
              }}
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                item.danger === true ? 'text-destructive' : 'text-foreground'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
