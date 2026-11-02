import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * The single button surface. Colours and heights come from tokens, so a screen
 * picks a variant instead of hand-writing Tailwind for every control.
 */
export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        secondary: 'border border-border bg-card text-foreground shadow-xs hover:bg-hover',
        ghost: 'text-foreground hover:bg-hover',
        subtle: 'bg-muted text-foreground hover:bg-hover',
        danger: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-control-xs px-1.5 text-2xs',
        sm: 'h-control-sm px-2 text-xs',
        md: 'h-control-md px-2.5 text-sm',
        icon: 'size-control-sm p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'sm' },
  }
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
