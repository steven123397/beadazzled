import { memo, useMemo } from 'react';

import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/time';

import { Badge } from '@/components/ui/badge';
import { PriorityIcon } from '@/components/ui/priority-icon';
import { StatusIcon } from '@/components/ui/status-icon';
import { statusText } from '@/lib/status';

export type RowProps = {
  issue: Issue;
  /** Vertical offset in the virtual list, in pixels. */
  start: number;
  focused: boolean;
  onOpen: (issue: Issue) => void;
  onFocus: (id: string) => void;
};

export function rowId(issueId: string): string {
  return `list-row-${issueId}`;
}

/**
 * One 36px list line. Memoized and given only stable props so scrolling does
 * not re-render every visible row when the virtual window moves.
 */
export const Row = memo(function Row({ issue, start, focused, onOpen, onFocus }: RowProps) {
  const { t, language } = useI18n();
  const statusLabel = statusText(issue.status, t);
  const visibleLabels = issue.labels.slice(0, 2);
  const extraLabels = issue.labels.length - visibleLabels.length;
  const moreLabels = extraLabels > 0 ? t('list.moreLabels', { count: extraLabels }) : '';
  const relative = useMemo(
    () => formatRelativeTime(issue.updated_at, language),
    [issue.updated_at, language]
  );
  const absolute = useMemo(
    () => formatAbsoluteTime(issue.updated_at, language),
    [issue.updated_at, language]
  );

  return (
    <div
      id={rowId(issue.id)}
      role="listitem"
      aria-current={focused ? 'true' : undefined}
      data-issue-id={issue.id}
      data-focused={focused ? 'true' : 'false'}
      tabIndex={focused ? 0 : -1}
      onClick={() => onOpen(issue)}
      onFocus={() => onFocus(issue.id)}
      className={`absolute left-0 top-0 flex w-full items-center gap-2 border-b border-border-subtle px-3 text-xs transition-colors ${
        focused ? 'bg-selected text-selected-foreground' : 'hover:bg-hover'
      }`}
      style={{ height: 'var(--row-height)', transform: `translateY(${start}px)` }}
    >
      <span className="flex w-28 shrink-0 items-center gap-1.5">
        <StatusIcon status={issue.status} />
        <span className="truncate">{statusLabel}</span>
      </span>
      <span className="w-20 shrink-0 truncate font-mono text-muted-foreground">{issue.id}</span>
      <span className="min-w-0 flex-1 truncate" title={issue.title}>
        {issue.title}
      </span>
      <span className="flex w-10 shrink-0 items-center justify-end gap-1 tabular-nums">
        <PriorityIcon priority={issue.priority} />P{issue.priority}
      </span>
      <span className="hidden w-16 shrink-0 truncate text-muted-foreground lg:block">
        {issue.issue_type}
      </span>
      <span
        className={`hidden w-24 shrink-0 truncate lg:block ${
          issue.assignee === undefined ? 'italic text-muted-foreground' : ''
        }`}
      >
        {issue.assignee ?? t('list.unassigned')}
      </span>
      <span
        className="hidden w-32 shrink-0 items-center gap-1 overflow-hidden lg:flex"
        title={issue.labels.join(', ')}
      >
        {visibleLabels.map((label, index) => (
          <Badge key={`${label}-${index}`} className="min-w-0 truncate">
            {label}
          </Badge>
        ))}
        {extraLabels > 0 ? (
          <span className="shrink-0 text-muted-foreground">{moreLabels}</span>
        ) : null}
      </span>
      <span
        className="hidden w-24 shrink-0 truncate text-right text-muted-foreground lg:block"
        title={absolute}
      >
        {relative}
      </span>
    </div>
  );
});
