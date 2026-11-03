import { memo, useMemo } from 'react';

import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/time';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PriorityIcon } from '@/components/ui/priority-icon';
import { StatusIcon } from '@/components/ui/status-icon';
import { statusText } from '@/lib/status';
import { cn } from '@/lib/utils';

export type RowProps = {
  issue: Issue;
  /** Vertical offset in the virtual list, in pixels. */
  start: number;
  focused: boolean;
  /** Hidden when every visible ticket shares one type; the space goes to the title. */
  showType: boolean;
  onOpen: (issue: Issue) => void;
  onFocus: (id: string) => void;
};

export function rowId(issueId: string): string {
  return `list-row-${issueId}`;
}

/**
 * One list line, drawn as a small inset card. Idle rows have no surface or
 * border; hover and focus paint the rounded card, so the list reads as a
 * single sheet until the pointer lands on a row.
 */
export const Row = memo(function Row({
  issue,
  start,
  focused,
  showType,
  onOpen,
  onFocus,
}: RowProps) {
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
      className={cn(
        'absolute left-1 right-1 top-0 flex items-center gap-2.5 rounded-md px-3 text-sm transition-colors focus-visible:outline-none',
        focused ? 'bg-selected text-selected-foreground' : 'hover:bg-hover'
      )}
      style={{ height: 'var(--row-height)', transform: `translateY(${start}px)` }}
    >
      {focused ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
        />
      ) : null}
      <span className="flex w-6 shrink-0 items-center justify-center" title={statusLabel}>
        <StatusIcon status={issue.status} label={statusLabel} className="size-4" />
      </span>
      <span className="w-24 shrink-0 truncate font-mono text-muted-foreground" title={issue.id}>
        {issue.id}
      </span>
      <span className="min-w-0 flex-1 truncate text-base font-medium" title={issue.title}>
        {issue.title}
      </span>
      <span className="flex w-6 shrink-0 items-center justify-center" title={`P${issue.priority}`}>
        <PriorityIcon priority={issue.priority} label={`P${issue.priority}`} className="size-4" />
      </span>
      {showType ? (
        <span className="hidden w-16 shrink-0 truncate text-muted-foreground lg:block">
          {issue.issue_type}
        </span>
      ) : null}
      <span className="hidden w-28 shrink-0 items-center gap-1.5 lg:flex">
        {issue.assignee === undefined ? (
          <>
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-full border border-dashed border-border-strong"
            />
            <span className="truncate italic text-muted-foreground">{t('list.unassigned')}</span>
          </>
        ) : (
          <>
            <Avatar name={issue.assignee} />
            <span className="truncate">{issue.assignee}</span>
          </>
        )}
      </span>
      <span
        className="hidden w-36 shrink-0 items-center gap-1 overflow-hidden lg:flex xl:w-40"
        title={issue.labels.join(', ')}
      >
        {visibleLabels.map((label, index) => (
          <Badge key={`${label}-${index}`} className="min-w-0 text-2xs" title={label}>
            <span className="min-w-0 truncate">{label}</span>
          </Badge>
        ))}
        {extraLabels > 0 ? (
          <span className="shrink-0 text-muted-foreground">{moreLabels}</span>
        ) : null}
      </span>
      <span
        className="hidden w-20 shrink-0 truncate text-right text-2xs text-muted-foreground lg:block"
        title={absolute}
      >
        {relative}
      </span>
    </div>
  );
});
