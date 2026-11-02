import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import type { IssueIndex } from '@/lib/store/selectors';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/time';

import { statusText } from '@/features/list/status';
import { Dependencies } from './Dependencies';

export function MetadataRail({
  issue,
  index,
  onOpenIssue,
}: {
  issue: Issue;
  index: IssueIndex;
  onOpenIssue?: (id: string) => void;
}) {
  const { t, language } = useI18n();

  return (
    <aside aria-labelledby="detail-metadata" className="min-w-0 text-xs">
      <h2 id="detail-metadata" className="text-sm font-semibold">
        {t('detail.metadata.title')}
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">{t('detail.metadata.status')}</dt>
        <dd>{statusText(issue.status, t)}</dd>

        <dt className="text-muted-foreground">{t('detail.metadata.priority')}</dt>
        <dd className="tabular-nums">P{issue.priority}</dd>

        <dt className="text-muted-foreground">{t('detail.metadata.type')}</dt>
        <dd>{issue.issue_type}</dd>

        <dt className="text-muted-foreground">{t('detail.metadata.assignee')}</dt>
        <dd>
          {issue.assignee === undefined ? (
            <span className="italic text-muted-foreground">{t('list.unassigned')}</span>
          ) : (
            issue.assignee
          )}
        </dd>

        <dt className="text-muted-foreground">{t('detail.metadata.labels')}</dt>
        <dd className="flex flex-wrap gap-1">
          {issue.labels.length === 0 ? (
            <span className="text-muted-foreground">{t('detail.metadata.none')}</span>
          ) : (
            issue.labels.map((label) => (
              <span key={label} className="rounded bg-muted px-1.5 py-0.5">
                {label}
              </span>
            ))
          )}
        </dd>

        <dt className="text-muted-foreground">{t('detail.metadata.created')}</dt>
        <dd title={formatAbsoluteTime(issue.created_at, language)}>
          {formatRelativeTime(issue.created_at, language)}
        </dd>

        <dt className="text-muted-foreground">{t('detail.metadata.updated')}</dt>
        <dd title={formatAbsoluteTime(issue.updated_at, language)}>
          {formatRelativeTime(issue.updated_at, language)}
        </dd>

        {issue.closed_at === undefined ? null : (
          <>
            <dt className="text-muted-foreground">{t('detail.metadata.closed')}</dt>
            <dd title={formatAbsoluteTime(issue.closed_at, language)}>
              {formatRelativeTime(issue.closed_at, language)}
            </dd>
          </>
        )}
      </dl>

      <Dependencies issue={issue} index={index} onOpenIssue={onOpenIssue} />
    </aside>
  );
}