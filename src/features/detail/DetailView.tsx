import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { getIssue, indexIssues } from '@/lib/store/selectors';

import { Comments } from './Comments';
import { Header } from './Header';
import { Markdown } from './Markdown';
import { MetadataRail } from './MetadataRail';

export type DetailViewProps = {
  issueId: string;
  issues: readonly Issue[];
  onBack: () => void;
  onOpenIssue?: (id: string) => void;
};

/**
 * The reading surface. It reads only the in-memory snapshot, so opening a
 * ticket never touches bd or the network.
 */
export function DetailView({ issueId, issues, onBack, onOpenIssue }: DetailViewProps) {
  const { t } = useI18n();
  const index = useMemo(() => indexIssues(issues), [issues]);
  const issue = getIssue(index, issueId);

  if (issue === undefined) {
    return (
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <button
          type="button"
          aria-label={t('detail.back')}
          onClick={onBack}
          className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
        >
          ← {t('detail.back')}
        </button>
        <h1 className="mt-4 text-lg font-semibold">{t('detail.notFound.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('detail.notFound.body')}</p>
      </div>
    );
  }

  const description = issue.description.trim();
  const acceptance = issue.acceptance_criteria?.trim() ?? '';
  const design = textField(issue, 'design');
  const notes = textField(issue, 'notes');

  return (
    <article className="mx-auto w-full max-w-[1100px] px-6 py-6">
      <Header issue={issue} onBack={onBack} />

      <div className="mt-6 grid gap-8 min-[1000px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <section aria-labelledby="detail-description">
            <h2 id="detail-description" className="text-sm font-semibold">
              {t('detail.description')}
            </h2>
            <div className="mt-2 max-w-[72ch]">
              {description === '' ? (
                <p className="text-sm text-muted-foreground">{t('detail.description.empty')}</p>
              ) : (
                <Markdown>{description}</Markdown>
              )}
            </div>
          </section>

          <section aria-labelledby="detail-acceptance" className="mt-6">
            <h2 id="detail-acceptance" className="text-sm font-semibold">
              {t('detail.acceptance')}
            </h2>
            <div className="mt-2 max-w-[72ch]">
              {acceptance === '' ? (
                <p className="text-sm text-muted-foreground">{t('detail.acceptance.empty')}</p>
              ) : (
                <Markdown>{acceptance}</Markdown>
              )}
            </div>
          </section>

          {design === null ? null : (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-semibold">{t('detail.design')}</summary>
              <div className="mt-2 max-w-[72ch]">
                <Markdown>{design}</Markdown>
              </div>
            </details>
          )}

          {notes === null ? null : (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold">{t('detail.notes')}</summary>
              <div className="mt-2 max-w-[72ch]">
                <Markdown>{notes}</Markdown>
              </div>
            </details>
          )}

          <Comments comments={issue.comments} />
        </div>

        <MetadataRail issue={issue} index={index} onOpenIssue={onOpenIssue} />
      </div>
    </article>
  );
}

/** Read the route params and remount the view when the ticket changes. */
export function DetailRoute({ issues }: { issues: readonly Issue[] }) {
  const { projectId = '', issueId = '' } = useParams<{ projectId: string; issueId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const back = useCallback(() => {
    // A deep link has no list entry to return to; a normal open should restore
    // the previous URL, which still carries the list filters.
    if (location.key === 'default') {
      navigate(`/w/${projectId}/list`, { replace: true });
      return;
    }
    navigate(-1);
  }, [location.key, navigate, projectId]);

  const openIssue = useCallback(
    (id: string) => navigate(`/w/${projectId}/issue/${encodeURIComponent(id)}`),
    [navigate, projectId]
  );

  return (
    <DetailView
      key={issueId}
      issueId={issueId}
      issues={issues}
      onBack={back}
      onOpenIssue={openIssue}
    />
  );
}

/**
 * `design` and `notes` are not first-class export fields; bd carries them in
 * the extra map. Only a non-empty string is rendered.
 */
function textField(issue: Issue, key: 'design' | 'notes'): string | null {
  const value = issue[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}