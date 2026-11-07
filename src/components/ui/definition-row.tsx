import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DefinitionRowProps {
  label: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
  variant?: 'flex' | 'grid';
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}

export function DefinitionRow({
  label,
  value,
  children,
  variant = 'flex',
  className,
  labelClassName,
  valueClassName,
}: DefinitionRowProps) {
  const content = value !== undefined ? value : children;

  if (variant === 'grid') {
    return (
      <div
        className={cn(
          'grid min-h-8 grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3',
          className
        )}
      >
        <dt className={cn('text-muted-foreground', labelClassName)}>{label}</dt>
        <dd className={cn('min-w-0', valueClassName)}>{content}</dd>
      </div>
    );
  }

  return (
    <div className={cn('flex justify-between gap-3', className)}>
      <dt className={cn('shrink-0 text-muted-foreground', labelClassName)}>{label}</dt>
      <dd className={cn('min-w-0 break-all text-right text-foreground', valueClassName)}>
        {content}
      </dd>
    </div>
  );
}

export const InfoRow = DefinitionRow;
