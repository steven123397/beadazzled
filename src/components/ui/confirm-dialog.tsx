import { useRef, type ReactNode } from 'react';

import { useFocusTrap } from '@/app/keyboard/useFocusTrap';
import { Button } from '@/components/ui/button';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  return (
    <div
      data-confirm-backdrop
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className="w-full max-w-sm space-y-3 rounded-lg border border-border bg-card p-4 text-foreground shadow-lg"
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
      </div>
    </div>
  );
}
