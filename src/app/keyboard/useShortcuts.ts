import { useEffect, useRef } from 'react';

import {
  isEditableTarget,
  resolveShortcut,
  type PendingSequence,
  type ResolveOptions,
} from './resolve';
import type { Shortcut, ShortcutContext } from './types';

/** Binds the window keydown listener and dispatches to the registered shortcut. */
export function useShortcuts(shortcuts: readonly Shortcut[], context: ShortcutContext): void {
  const shortcutsRef = useRef(shortcuts);
  const contextRef = useRef(context);
  const pendingRef = useRef<PendingSequence>(null);

  shortcutsRef.current = shortcuts;
  contextRef.current = context;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // A capture-phase handler (for example the detail editor cancelling a
      // draft with Escape) gets the first say.
      if (event.defaultPrevented) {
        return;
      }
      const options: ResolveOptions = {
        now: performance.now(),
        pending: pendingRef.current,
        editable: isEditableTarget(event.target),
      };
      const active = shortcutsRef.current.filter((shortcut) => shortcut.when?.() !== false);
      const result = resolveShortcut(active, event, options);
      pendingRef.current = result.pending;

      if (result.binding !== null) {
        event.preventDefault();
        result.binding.run(contextRef.current);
        return;
      }
      if (result.pending !== null) {
        // Swallow the prefix so a chord never types into the page.
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
