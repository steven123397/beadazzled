import { useEffect } from 'react';

import { isEditableTarget, isOverlayOpen } from '@/lib/dom/focus';
import type { Issue } from '@/bindings/bd';

import type { EditableField } from './useDetailWrites';

export interface UseDetailShortcutsOptions {
  issue: Issue | undefined;
  canEdit: boolean;
  editing: EditableField | null;
  beginEdit: (field: EditableField) => void;
  cancelEdit: () => void;
}

/**
 * Detail single-key shortcuts. Inputs and open overlays are excluded by the
 * same helpers the shell uses, so typing never triggers them.
 */
export function useDetailShortcuts({
  issue,
  canEdit,
  editing,
  beginEdit,
  cancelEdit,
}: UseDetailShortcutsOptions) {
  useEffect(() => {
    if (issue === undefined || !canEdit) {
      return undefined;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // A modal above the page owns Escape, even while a draft is open behind
      // it: otherwise the palette would stay up and the draft would vanish.
      if (isOverlayOpen()) {
        return;
      }
      if (editing !== null) {
        // Escape leaves the editor instead of the page; the input itself also
        // handles this when focused and stops propagation.
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancelEdit();
        }
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      switch (event.key.toLowerCase()) {
        case 'e':
          event.preventDefault();
          beginEdit('title');
          break;
        case 'a':
          event.preventDefault();
          beginEdit('acceptance');
          break;
        case 'c':
          event.preventDefault();
          document.getElementById('detail-comment-input')?.focus();
          break;
        case 's':
          event.preventDefault();
          document.getElementById('detail-status')?.focus();
          break;
        case 'p':
          event.preventDefault();
          document.getElementById('detail-priority')?.focus();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [beginEdit, canEdit, cancelEdit, editing, issue]);
}
