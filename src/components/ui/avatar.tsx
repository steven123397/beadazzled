import { cn } from '@/lib/utils';

export type AvatarProps = {
  /** Display name; the initials are derived from it. */
  name: string;
  size?: 'xs' | 'sm';
  className?: string;
};

/** Initials stand in for a profile picture; no remote images are fetched. */
export function Avatar({ name, size = 'xs', className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-medium uppercase text-muted-foreground',
        size === 'xs' ? 'size-4 text-[10px]' : 'size-5 text-[11px]',
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2);
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}
