import { StatusIcon } from '@/components/ui/status-icon';
import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { getBlockedBy, getBlocks, type IssueIndex, type IssueRef } from '@/lib/store/selectors';

import { statusText } from '@/lib/status';

export function Dependencies({
  issue,
  index,
  onOpenIssue,
}: {
  issue: Issue;
  index: IssueIndex;
  onOpenIssue?: (id: string) => void;
}) {
  const { t } = useI18n();
  const blockedBy = getBlockedBy(index, issue.id);
  const blocks = getBlocks(index, issue.id);

  return (
    <section aria-labelledby="detail-dependencies" className="mt-6">
      <h2 id="detail-dependencies" className="text-sm font-semibold">
        {t('detail.dependencies.title')}
      </h2>
      {blockedBy.length === 0 && blocks.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('detail.dependencies.none')}</p>
      ) : (
        <div className="mt-3 space-y-4">
          <Group
            label={t('detail.dependencies.blockedBy')}
            refs={blockedBy}
            onOpenIssue={onOpenIssue}
          />
          <Group label={t('detail.dependencies.blocks')} refs={blocks} onOpenIssue={onOpenIssue} />
        </div>
      )}
    </section>
  );
}

function Group({
  label,
  refs,
  onOpenIssue,
}: {
  label: string;
  refs: readonly IssueRef[];
  onOpenIssue?: (id: string) => void;
}) {
  const { t } = useI18n();
  if (refs.length === 0) {
    return null;
  }

  return (
    <section aria-label={label}>
      <h3 className="flex items-center gap-1.5 px-1.5 text-xs font-medium text-muted-foreground">
        {label}
        <span className="rounded-sm bg-muted px-1 text-2xs leading-4 tabular-nums">
          {refs.length}
        </span>
      </h3>
      <ul className="mt-1 space-y-0.5">
        {refs.map((ref) => (
          <li key={ref.id}>
            {ref.issue === undefined ? (
              <span className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground">
                <span className="font-mono">{ref.id}</span>
                <span className="truncate italic">{t('detail.dependencies.missing')}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenIssue?.(ref.id)}
                title={ref.issue.title}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-hover"
              >
                <StatusIcon status={ref.issue.status} />
                <span className="min-w-0 flex-1 truncate">{ref.issue.title}</span>
                <span className="shrink-0 font-mono text-2xs text-muted-foreground">{ref.id}</span>
                <span className="sr-only">{statusText(ref.issue.status, t)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
