import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { getBlockedBy, getBlocks, type IssueIndex, type IssueRef } from '@/lib/store/selectors';

import { statusText } from '@/features/list/status';

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
        <>
          <Group
            label={t('detail.dependencies.blockedBy')}
            refs={blockedBy}
            onOpenIssue={onOpenIssue}
          />
          <Group label={t('detail.dependencies.blocks')} refs={blocks} onOpenIssue={onOpenIssue} />
        </>
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
  const closed = refs.filter((ref) => ref.issue?.status === 'closed').length;

  return (
    <section aria-label={label} className="mt-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label} ({refs.length})
      </h3>
      <ul className="mt-1 space-y-1">
        {refs.map((ref) => (
          <li key={ref.id} className="text-xs">
            {ref.issue === undefined ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono text-foreground">{ref.id}</span>
                <span className="italic">{t('detail.dependencies.missing')}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenIssue?.(ref.id)}
                className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
              >
                <span className="shrink-0 font-mono">{ref.id}</span>
                <span className="min-w-0 flex-1 truncate">{ref.issue.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {statusText(ref.issue.status, t)}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {closed > 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('detail.dependencies.closed', { count: closed })}
        </p>
      ) : null}
    </section>
  );
}