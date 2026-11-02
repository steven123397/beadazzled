import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import type { Issue } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { getIssue, indexIssues } from '@/lib/store/selectors';
import { commentIssue, updateIssue, type UpdateInput } from '@/lib/writes/commands';
import type { UseWrite } from '@/lib/writes/useWrite';

import { Comments } from './Comments';
import { Editor } from './Editor';
import { Header } from './Header';
import { Markdown } from './Markdown';
import { MetadataRail } from './MetadataRail';

export type DetailViewProps = {
  issueId: string;
  issues: readonly Issue[];
  onBack: () => void;
  onOpenIssue?: (id: string) => void;
  /** The baseline is still arriving; a missing id is not "deleted" yet. */
  loading?: boolean;
  /** Omitted in read-only tests; the production shell always passes it. */
  writes?: UseWrite;
};

type EditableField = 'title' | 'description' | 'acceptance';

/**
 * The reading surface. It reads only the in-memory snapshot, so opening a
 * ticket never touches bd or the network.
 */
export function DetailView({
  issueId,
  issues,
  onBack,
  onOpenIssue,
  loading,
  writes,
}: DetailViewProps) {
  const { t } = useI18n();
  const index = useMemo(() => indexIssues(issues), [issues]);
  const issue = getIssue(index, issueId);
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (issue === undefined) {
    if (loading === true) {
      return (
        <p role="status" className="px-6 py-10 text-sm text-muted-foreground">
          {t('detail.loading')}
        </p>
      );
    }
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
  const pending = writes?.isPending(issue.id) ?? false;
  const canEdit = writes?.canWrite === true;
  const editorError = validationError ?? writes?.error ?? null;

  const beginEdit = (field: EditableField) => {
    writes?.clearError();
    setValidationError(null);
    setEditing(field);
  };

  const cancelEdit = () => {
    writes?.clearError();
    setValidationError(null);
    setEditing(null);
  };

  const saveField = async (field: EditableField, next: string): Promise<boolean> => {
    if (writes === undefined) {
      setValidationError(t('detail.write.unavailable'));
      return false;
    }
    if (field === 'title' && next.trim() === '') {
      setValidationError(t('detail.edit.titleEmpty'));
      return false;
    }
    setValidationError(null);

    const value = field === 'title' ? next.trim() : next;
    const input: UpdateInput =
      field === 'title'
        ? { title: value }
        : field === 'description'
          ? { description: value }
          : { acceptance: value };
    const result = updateIssue(issue.id, input);
    if (!result.ok) {
      setValidationError(result.error.message);
      return false;
    }

    const outcome = await writes.submit({
      key: `detail:${issue.id}:${field}:${value}`,
      issueId: issue.id,
      build: () => result.command,
    });
    if (outcome.status === 'ok') {
      setEditing(null);
      return true;
    }
    return false;
  };

  const editButton = (field: EditableField) =>
    canEdit && editing === null ? (
      <button
        type="button"
        onClick={() => beginEdit(field)}
        className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
      >
        {t('detail.edit.edit')}
      </button>
    ) : null;

  const submitComment = async (text: string): Promise<boolean> => {
    if (writes === undefined) {
      return false;
    }
    const outcome = await writes.submit({
      key: `detail:${issue.id}:comment:${text}`,
      issueId: issue.id,
      build: () => commentIssue(issue.id, text),
    });
    return outcome.status === 'ok';
  };

  return (
    <article className="mx-auto w-full max-w-[1100px] px-6 py-6">
      <Header
        issue={issue}
        onBack={onBack}
        hideTitle={editing === 'title'}
        onEditTitle={canEdit ? () => beginEdit('title') : undefined}
      />

      {editing === 'title' ? (
        <div className="mt-3">
          <Editor
            label={t('detail.edit.title')}
            value={issue.title}
            pending={pending}
            disabled={!canEdit}
            error={editorError}
            onSave={(next) => saveField('title', next)}
            onCancel={cancelEdit}
          />
        </div>
      ) : null}

      {writes !== undefined && !writes.canWrite ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {writes.disabledReason ?? t('detail.write.unavailable')}
        </p>
      ) : null}

      <div className="mt-6 grid gap-8 min-[1000px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <section aria-labelledby="detail-description">
            <div className="flex items-center justify-between gap-2">
              <h2 id="detail-description" className="text-sm font-semibold">
                {t('detail.description')}
              </h2>
              {editButton('description')}
            </div>
            <div className="mt-2 max-w-[72ch]">
              {editing === 'description' ? (
                <Editor
                  label={t('detail.description')}
                  value={issue.description}
                  multiline
                  previewable
                  pending={pending}
                  disabled={!canEdit}
                  error={editorError}
                  onSave={(next) => saveField('description', next)}
                  onCancel={cancelEdit}
                />
              ) : description === '' ? (
                <p className="text-sm text-muted-foreground">{t('detail.description.empty')}</p>
              ) : (
                <Markdown>{description}</Markdown>
              )}
            </div>
          </section>

          <section aria-labelledby="detail-acceptance" className="mt-6">
            <div className="flex items-center justify-between gap-2">
              <h2 id="detail-acceptance" className="text-sm font-semibold">
                {t('detail.acceptance')}
              </h2>
              {editButton('acceptance')}
            </div>
            <div className="mt-2 max-w-[72ch]">
              {editing === 'acceptance' ? (
                <Editor
                  label={t('detail.acceptance')}
                  value={issue.acceptance_criteria ?? ''}
                  multiline
                  pending={pending}
                  disabled={!canEdit}
                  error={editorError}
                  onSave={(next) => saveField('acceptance', next)}
                  onCancel={cancelEdit}
                />
              ) : acceptance === '' ? (
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

          <Comments
            comments={issue.comments}
            onSubmit={canEdit ? submitComment : undefined}
            pending={pending}
            disabled={!canEdit}
            error={writes?.error ?? null}
          />
        </div>

        <MetadataRail issue={issue} index={index} onOpenIssue={onOpenIssue} />
      </div>
    </article>
  );
}

/** Read the route params and remount the view when the ticket changes. */
export function DetailRoute({
  issues,
  loading,
  writes,
}: {
  issues: readonly Issue[];
  loading?: boolean;
  writes?: UseWrite;
}) {
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
      loading={loading}
      writes={writes}
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