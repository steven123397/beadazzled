import { forwardRef, useImperativeHandle, useRef, type HTMLAttributes } from 'react';
import { useFocusTrap } from '@/app/keyboard/useFocusTrap';

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
