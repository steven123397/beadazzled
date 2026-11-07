import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DialogSurface } from '@/components/ui/modal';

export type ConfirmDialogProps = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * One confirmation surface for every destructive action, so "remove" never
 * looks different from screen to screen.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      data-confirm-backdrop
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <DialogSurface
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-raised p-4 text-foreground shadow-lg"
      >
        <h2 id="confirm-title" className="text-sm font-semibold">
          {title}
        </h2>
        <div className="text-xs text-muted-foreground">{children}</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogSurface>
    </div>
  );
}
