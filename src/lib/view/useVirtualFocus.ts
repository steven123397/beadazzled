import { useCallback, useEffect, useRef, useState } from 'react';

export interface VirtualizerLike {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'start' | 'center' | 'end' }) => void;
  getVirtualItems: () => readonly unknown[];
}

export interface UseVirtualFocusOptions<T> {
  getItemId: (item: T) => string | undefined;
  getElementId: (id: string) => string;
}

/**
 * Coordinates virtual scrolling with keyboard and programmatic focus.
 *
 * Virtualized rows/cards may not exist in the DOM when focus is requested.
 * This hook scrolls the item into view, queues the focus request, and focuses
 * the element as soon as the virtualizer has rendered it into the DOM.
 */
export function useVirtualFocus<T>(
  virtualizer: VirtualizerLike,
  items: readonly T[],
  options: UseVirtualFocusOptions<T>
) {
  const pendingFocusRef = useRef<string | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const { getItemId, getElementId } = options;

  const focusItem = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => getItemId(item) === id);
      if (index === -1) {
        return;
      }
      pendingFocusRef.current = id;
      setRequestCount((count) => count + 1);
      virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [getItemId, items, virtualizer]
  );

  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const id = pendingFocusRef.current;
    if (id === null) {
      return;
    }
    const element = document.getElementById(getElementId(id));
    if (element === null) {
      return;
    }
    pendingFocusRef.current = null;
    element.focus({ preventScroll: true });
  }, [getElementId, requestCount, virtualItems]);

  return { focusItem, pendingFocusRef };
}
