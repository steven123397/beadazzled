import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { useFocusTrap } from '@/app/keyboard/useFocusTrap';
import { cn } from '@/lib/utils';

export interface DialogSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  active?: boolean;
}

export const DialogSurface = forwardRef<HTMLDivElement, DialogSurfaceProps>(function DialogSurface(
  { role = 'dialog', tabIndex = -1, active = true, className, children, ...props },
  forwardedRef
) {
  const localRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => localRef.current as HTMLDivElement);
  useFocusTrap(localRef, active);

  return (
    <div
      ref={localRef}
      role={role}
      aria-modal="true"
      tabIndex={tabIndex}
      className={className}
      {...props}
    >
      {children}
    </div>
  );
});

export interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  backdropClassName?: string;
  onBackdropClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export const Modal = forwardRef<HTMLDivElement, ModalProps>(function Modal(
  { backdropClassName, onBackdropClick, className, children, ...props },
  ref
) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4',
        backdropClassName
      )}
      onClick={onBackdropClick}
      {...props}
    >
      <DialogSurface ref={ref} className={className}>
        {children}
      </DialogSurface>
    </div>
  );
});
