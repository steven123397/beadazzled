import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium leading-none',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted text-foreground/80',
        outline: 'border-border bg-transparent text-foreground',
        accent: 'border-transparent bg-primary/12 text-primary-text',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/14 text-warning',
        danger: 'border-transparent bg-destructive/12 text-destructive',
      },
    },
    defaultVariants: { variant: 'neutral' },
  }
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
