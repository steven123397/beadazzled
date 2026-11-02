import { useI18n } from '@/lib/i18n/I18nProvider';

import { statusText } from './status';
import type { GroupBy } from './view-state';

export const GROUP_HEIGHT = 32;

export type GroupHeaderProps = {
  group: Exclude<GroupBy, 'none'>;
  groupKey: string;
  count: number;
  collapsed: boolean;
  start: number;
  onToggle: () => void;
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

  return (
    <div
      role="listitem"
      className="absolute left-0 top-0 w-full border-b border-border bg-muted/40"
      style={{ height: `${GROUP_HEIGHT}px`, transform: `translateY(${start}px)` }}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex h-full w-full items-center gap-2 px-3 text-left text-xs font-medium"
      >
        <span aria-hidden="true" className="w-3 text-muted-foreground">
          {collapsed ? '▸' : '▾'}
        </span>
        <span>{label}</span>
        <span className="text-muted-foreground">{count}</span>
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
