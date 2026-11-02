import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { buttonVariants, type ButtonProps } from './button';

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> &
  Pick<ButtonProps, 'variant'> & {
    /** Required: an icon-only control has no visible text to name it. */
    label: string;
    size?: 'xs' | 'sm' | 'md';
    children: ReactNode;
  };

/** A square button that shows one icon; the label is its accessible name. */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'sm',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant, size: 'icon' }), sizeClass(size), className)}
      {...props}
    >
      {children}
    </button>
  );
}

function sizeClass(size: 'xs' | 'sm' | 'md'): string {
  switch (size) {
    case 'xs':
      return 'size-control-xs';
    case 'md':
      return 'size-control-md';
    default:
      return 'size-control-sm';
  }
}
