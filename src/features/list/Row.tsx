import { memo, useMemo } from 'react';

import type { Issue } from '@/bindings/bd';
import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';

export type RowProps = {
  issue: Issue;
  /** Vertical offset in the virtual list, in pixels. */
  start: number;
  focused: boolean;
  onOpen: (issue: Issue) => void;
  onFocus: (id: string) => void;
};

const STATUS_ICONS: Record<string, string> = {
  open: '○',
  in_progress: '◐',
  blocked: '⊘',
  deferred: '❄',
  closed: '✓',
  pinned: '⌖',
  hooked: '↪',
};

const STATUS_LABELS: Record<string, MessageKey> = {
  open: 'list.status.open',
  in_progress: 'list.status.in_progress',
  blocked: 'list.status.blocked',
  deferred: 'list.status.deferred',
  closed: 'list.status.closed',
  pinned: 'list.status.pinned',
  hooked: 'list.status.hooked',
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
  const statusKey = STATUS_LABELS[issue.status];
  const statusLabel = statusKey === undefined ? issue.status : t(statusKey);
  const statusIcon = STATUS_ICONS[issue.status] ?? '?';
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
      role="option"
      aria-selected={focused}
      data-issue-id={issue.id}
      data-focused={focused ? 'true' : 'false'}
      tabIndex={focused ? 0 : -1}
      onClick={() => onOpen(issue)}
      onFocus={() => onFocus(issue.id)}
      className={`absolute left-0 top-0 flex w-full items-center gap-2 border-b border-border px-3 text-xs ${
        focused ? 'bg-muted' : 'hover:bg-muted/60'
      }`}
      style={{ height: 'var(--row-height)', transform: `translateY(${start}px)` }}
    >
      <span className="flex w-28 shrink-0 items-center gap-1.5">
        <span aria-hidden="true" className="w-4 text-center text-muted-foreground">
          {statusIcon}
        </span>
        <span className="truncate">{statusLabel}</span>
      </span>
      <span className="w-20 shrink-0 truncate font-mono text-muted-foreground">{issue.id}</span>
      <span className="min-w-0 flex-1 truncate" title={issue.title}>
        {issue.title}
      </span>
      <span className="w-8 shrink-0 text-center tabular-nums">P{issue.priority}</span>
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
        {visibleLabels.map((label) => (
          <span key={label} className="truncate rounded bg-muted px-1 py-0.5 text-[11px]">
            {label}
          </span>
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

function formatRelativeTime(value: string, language: 'en' | 'zh-CN'): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const magnitude = Math.abs(seconds);
  const formatter = relativeFormatter(language);

  if (magnitude < 60) {
    return formatter.format(seconds, 'second');
  }
  if (magnitude < 3600) {
    return formatter.format(Math.round(seconds / 60), 'minute');
  }
  if (magnitude < 86_400) {
    return formatter.format(Math.round(seconds / 3600), 'hour');
  }
  if (magnitude < 2_592_000) {
    return formatter.format(Math.round(seconds / 86_400), 'day');
  }
  if (magnitude < 31_536_000) {
    return formatter.format(Math.round(seconds / 2_592_000), 'month');
  }
  return formatter.format(Math.round(seconds / 31_536_000), 'year');
}

function formatAbsoluteTime(value: string, language: 'en' | 'zh-CN'): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? value : absoluteFormatter(language).format(timestamp);
}

// Constructing Intl objects is comparatively expensive; scrolling mounts rows
// every frame, so the formatters live for the life of the page.
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

function relativeFormatter(language: 'en' | 'zh-CN'): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(language);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    relativeFormatters.set(language, formatter);
  }
  return formatter;
}

function absoluteFormatter(language: 'en' | 'zh-CN'): Intl.DateTimeFormat {
  let formatter = absoluteFormatters.get(language);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(language);
    absoluteFormatters.set(language, formatter);
  }
  return formatter;
}
