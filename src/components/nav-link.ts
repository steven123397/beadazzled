import { cn } from '@/lib/utils';

export const NAV_LINK_BASE =
  'flex h-control-sm w-full items-center rounded-md px-2 text-sm transition-colors';
export const ACTIVE_CLASS = 'bg-selected font-medium text-selected-foreground';
export const IDLE_CLASS = 'text-muted-foreground hover:bg-hover hover:text-foreground';

export function navLinkClass(isActive: boolean, hasGap: boolean = false): string {
  return cn(NAV_LINK_BASE, hasGap && 'gap-2', isActive ? ACTIVE_CLASS : IDLE_CLASS);
}
