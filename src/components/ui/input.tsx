import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const FIELD =
  'w-full rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';

export type InputProps = ComponentProps<'input'>;

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(FIELD, 'h-control-sm px-2 text-xs', className)} {...props} />;
}

export type TextareaProps = ComponentProps<'textarea'>;

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cn(FIELD, 'px-2 py-1.5 text-sm', className)} {...props} />;
}
