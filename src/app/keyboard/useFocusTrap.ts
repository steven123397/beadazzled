import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab/Shift+Tab inside a modal surface and restores the previous focus
 * when it closes. `aria-modal` alone does not stop the browser from tabbing
 * into the dimmed background.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const node = container.current;
    if (node === null) {
      return undefined;
    }

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    const items = focusables();
    if (!node.contains(document.activeElement)) {
      (items[0] ?? node).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !node.contains(document.activeElement)) {
        return;
      }
      const currentItems = focusables();
      if (currentItems.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = currentItems[0];
      const last = currentItems[currentItems.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus();
    };
  }, [active, container]);
}
