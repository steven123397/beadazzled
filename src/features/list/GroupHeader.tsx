import { ChevronDown } from 'lucide-react';

import { useI18n } from '@/lib/i18n/I18nProvider';

import { PriorityIcon } from '@/components/ui/priority-icon';
import { StatusIcon } from '@/components/ui/status-icon';
import { statusText } from '@/lib/status';
import { cn } from '@/lib/utils';
import type { GroupBy } from '@/lib/view/state';

export const GROUP_HEIGHT = 36;

export type GroupHeaderProps = {
  group: Exclude<GroupBy, 'none'>;
  groupKey: string;
  count: number;
  collapsed: boolean;
  start: number;
  onToggle: (key: string) => void;
};

/** One collapsible group heading inside the virtual list. */
export function GroupHeader({
  group,
  groupKey,
  count,
  collapsed,
  start,
  onToggle,
}: GroupHeaderProps) {
  const { t } = useI18n();
  const label = groupLabel(group, groupKey, t);
  const icon =
    group === 'status' ? (
      <StatusIcon status={groupKey} className="size-4" />
    ) : group === 'priority' ? (
      <PriorityIcon priority={Number(groupKey)} className="size-4" />
    ) : null;

  return (
    <div
      role="listitem"
      className="absolute left-1 right-1 top-0.5 rounded-md bg-muted/50"
      style={{
        height: `calc(${GROUP_HEIGHT}px - 6px)`,
        transform: `translateY(${start}px)`,
      }}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggle(groupKey)}
        className="flex h-full w-full items-center gap-2 rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            collapsed && '-rotate-90'
          )}
        />
        {icon}
        <span className="truncate">{label}</span>
        <span className="tabular-nums text-muted-foreground">{count}</span>
      </button>
    </div>
  );
}

function groupLabel(
  group: Exclude<GroupBy, 'none'>,
  key: string,
  t: Parameters<typeof statusText>[1]
): string {
  switch (group) {
    case 'status':
      return statusText(key, t);
    case 'priority':
      return `P${key}`;
    case 'type':
      return key;
    case 'assignee':
      return key === '' ? t('list.unassigned') : key;
  }
}
