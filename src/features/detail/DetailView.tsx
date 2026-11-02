import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { isEditableTarget, isOverlayOpen } from '@/app/keyboard/resolve';
import type { Issue } from '@/bindings/bd';
import { confirmLeaveDraft, setDraftGuard } from '@/lib/draft-guard';
import { describeError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { getIssue, indexIssues } from '@/lib/store/selectors';
import { commentIssue, updateIssue, type UpdateInput } from '@/lib/writes/commands';
import type { UseWrite } from '@/lib/writes/useWrite';

import { Comments } from './Comments';
import { changedFields, type DraftField } from './changes';
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
  // Every local draft on the page reports up, so navigation asks once no
  // matter which surface holds unsaved input.
  const [fieldDirty, setFieldDirty] = useState(false);
  const [commentDirty, setCommentDirty] = useState(false);
  const [railDirty, setRailDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);
  // Set when the ticket changes while a draft is open and the change was not
  // caused by this page.
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lastSeen = useRef<Issue | null>(null);
  // Fields this page has written since the current draft opened; their echo is
  // the page's own doing, not someone else's edit.
  const selfFields = useRef(new Set<DraftField>());
  const canEdit = writes?.canWrite === true;
  const hasDraft = fieldDirty || commentDirty || railDirty;

  const noteSelfWrite = useCallback((fields: readonly DraftField[]) => {
    for (const field of fields) {
      selfFields.current.add(field);
    }
  }, []);

  const beginEdit = useCallback(
    (field: EditableField) => {
      writes?.clearError();
      setValidationError(null);
      setNotice(null);
      setFieldDirty(false);
      setExternalUpdate(false);
      selfFields.current.clear();
      setEditing(field);
    },
    [writes]
  );

  const cancelEdit = useCallback(() => {
    writes?.clearError();
    setValidationError(null);
    setFieldDirty(false);
    setExternalUpdate(false);
    setEditing(null);
  }, [writes]);

  const requestBack = useCallback(() => {
    if (!confirmLeaveDraft()) {
      return;
    }
    onBack();
  }, [onBack]);

  // Shell navigation (sidebar, palette, workspace switch) consults the same
  // guard before it unmounts this page.
  useEffect(() => {
    if (!hasDraft) {
      setDraftGuard(null);
      return undefined;
    }
    setDraftGuard(() => window.confirm(t('detail.edit.discard')));
    return () => setDraftGuard(null);
  }, [hasDraft, t]);

  // A browser reload or window close is the one navigation React Router
  // cannot intercept; ask the platform to confirm while a draft is open.
  useEffect(() => {
    if (!hasDraft) {
      return undefined;
    }
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDraft]);

  // A ticket that was on screen and then vanished was deleted; one that never
  // appeared may simply still be deep-linked from another workspace. An edit
  // that is not this page's own write means someone else changed the ticket.
  useEffect(() => {
    const previous = lastSeen.current;
    if (issue !== undefined) {
      lastSeen.current = issue;
      setDeleted(false);
      if (
        previous !== null &&
        previous.id === issue.id &&
        previous.updated_at !== issue.updated_at
      ) {
        const changed = changedFields(previous, issue);
        const own = changed.length > 0 && changed.every((field) => selfFields.current.has(field));
        for (const field of changed) {
          selfFields.current.delete(field);
        }
        if (!own && editing !== null) {
          setExternalUpdate(true);
        }
      }
      return undefined;
    }
    if (previous === null || loading === true) {
      return undefined;
    }
    setDeleted(true);
    const timer = setTimeout(onBack, 3_000);
    return () => clearTimeout(timer);
  }, [editing, issue, loading, onBack]);

  // Detail single-key shortcuts. Inputs and open overlays are excluded by the
  // same helpers the shell uses, so typing never triggers them.
  useEffect(() => {
    if (issue === undefined || !canEdit) {
      return undefined;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      // A modal above the page owns Escape, even while a draft is open behind
      // it: otherwise the palette would stay up and the draft would vanish.
      if (isOverlayOpen()) {
        return;
      }
      if (editing !== null) {
        // Escape leaves the editor instead of the page; the input itself also
        // handles this when focused and stops propagation.
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancelEdit();
        }
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      switch (event.key.toLowerCase()) {
        case 'e':
          event.preventDefault();
          beginEdit('title');
          break;
        case 'a':
          event.preventDefault();
          beginEdit('acceptance');
          break;
        case 'c':
          event.preventDefault();
          document.getElementById('detail-comment-input')?.focus();
          break;
        case 's':
          event.preventDefault();
          document.getElementById('detail-status')?.focus();
          break;
        case 'p':
          event.preventDefault();
          document.getElementById('detail-priority')?.focus();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [beginEdit, canEdit, cancelEdit, editing, issue]);

  if (issue === undefined) {
    if (loading === true) {
      return (
        <p role="status" className="px-6 py-10 text-sm text-muted-foreground">
          {t('detail.loading')}
        </p>
      );
    }
    if (deleted) {
      return (
        <div className="mx-auto w-full max-w-lg px-6 py-10">
          <p role="status" className="rounded border border-warning px-3 py-2 text-sm text-warning">
            {t('detail.deleted')}
          </p>
          <button
            type="button"
            aria-label={t('detail.back')}
            onClick={requestBack}
            className="mt-3 rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
          >
            ← {t('detail.back')}
          </button>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <button
          type="button"
          aria-label={t('detail.back')}
          onClick={requestBack}
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
  const editorError = validationError;
  const updatedElsewhere = editing !== null && externalUpdate;

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

    noteSelfWrite([field === 'acceptance' ? 'acceptance_criteria' : field]);
    const outcome = await writes.submit({
      key: `detail:${issue.id}:${field}:${value}`,
      issueId: issue.id,
      build: () => result.command,
    });
    if (outcome.status === 'ok') {
      setEditing(null);
      setExternalUpdate(false);
      if (outcome.echo !== undefined && outcome.echo !== 'echoed') {
        setNotice(t('detail.write.refreshed'));
      }
      return true;
    }
    setValidationError(describeError(outcome.error).message);
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
    setCommentError(null);
    noteSelfWrite(['comments']);
    const outcome = await writes.submit({
      key: `detail:${issue.id}:comment:${text}`,
      issueId: issue.id,
      build: () => commentIssue(issue.id, text),
    });
    if (outcome.status === 'ok') {
      if (outcome.echo !== undefined && outcome.echo !== 'echoed') {
        setNotice(t('detail.write.refreshed'));
      }
      return true;
    }
    setCommentError(describeError(outcome.error).message);
    return false;
  };

  return (
    <article className="mx-auto w-full max-w-[1100px] px-6 py-6">
      <Header
        issue={issue}
        onBack={requestBack}
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
            onDirtyChange={setFieldDirty}
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

      {updatedElsewhere ? (
        <p role="status" className="mt-3 text-xs text-warning">
          {t('detail.edit.updatedElsewhere')}
        </p>
      ) : null}

      {notice === null ? null : (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {notice}
        </p>
      )}

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
                  onDirtyChange={setFieldDirty}
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
                  onDirtyChange={setFieldDirty}
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
              <summary className="cursor-pointer text-sm font-semibold">
                {t('detail.design')}
              </summary>
              <div className="mt-2 max-w-[72ch]">
                <Markdown>{design}</Markdown>
              </div>
            </details>
          )}

          {notes === null ? null : (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold">
                {t('detail.notes')}
              </summary>
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
            error={commentError}
            onDirtyChange={setCommentDirty}
          />
        </div>

        <MetadataRail
          issue={issue}
          index={index}
          onOpenIssue={onOpenIssue}
          writes={writes}
          onDirtyChange={setRailDirty}
          onSelfWrite={noteSelfWrite}
        />
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
    (id: string) => {
      if (!confirmLeaveDraft()) {
        return;
      }
      navigate(`/w/${projectId}/issue/${encodeURIComponent(id)}`);
    },
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
