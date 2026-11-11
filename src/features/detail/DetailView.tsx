import { ChevronRight } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import type { Issue } from '@/bindings/bd';
import { confirmLeaveDraft } from '@/lib/draft-guard';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { lookupFrom } from '@/lib/issues';
import { openExternal } from '@/lib/links';
import { indexIssues } from '@/lib/store/selectors';
import type { UseWrite } from '@/lib/writes/useWrite';

import { Comments } from './Comments';
import { textField } from './changes';
import { Editor } from './Editor';
import { DetailToolbar, Header } from './Header';
import { Markdown } from './Markdown';
import { MetadataRail } from './MetadataRail';
import { useDetailShortcuts } from './useDetailShortcuts';
import { useDetailWrites, type EditableField } from './useDetailWrites';

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

type EditableSectionConfig = {
  field: EditableField;
  label: string;
  value: string;
  headingId?: string;
  emptyText?: string;
  multiline?: boolean;
  previewable?: boolean;
  className?: string;
};

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
  const issue = lookupFrom(index.byId)(issueId);

  const {
    editing,
    canEdit,
    pending,
    deleted,
    notice,
    setNotice,
    validationError,
    commentError,
    updatedElsewhere,
    setFieldDirty,
    setCommentDirty,
    setRailDirty,
    noteSelfWrite,
    beginEdit,
    cancelEdit,
    saveField,
    submitComment,
  } = useDetailWrites({
    issue,
    writes,
    loading,
    onBack,
  });

  useDetailShortcuts({
    issue,
    canEdit,
    editing,
    beginEdit,
    cancelEdit,
  });

  // The OS has no default browser for the scheme, the plugin is missing, or
  // the shell refused the call: none of that may look like a dead click.
  const openLink = useCallback(
    async (url: string) => {
      try {
        await openExternal(url);
      } catch {
        setNotice(t('detail.link.failed'));
      }
    },
    [setNotice, t]
  );

  const requestBack = useCallback(() => {
    if (!confirmLeaveDraft()) {
      return;
    }
    onBack();
  }, [onBack]);

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
          <Button
            variant="secondary"
            aria-label={t('detail.back')}
            onClick={requestBack}
            className="mt-3"
          >
            ← {t('detail.back')}
          </Button>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <Button variant="secondary" aria-label={t('detail.back')} onClick={requestBack}>
          ← {t('detail.back')}
        </Button>
        <h1 className="mt-4 text-lg font-semibold">{t('detail.notFound.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('detail.notFound.body')}</p>
      </div>
    );
  }

  const design = textField(issue, 'design');
  const notes = textField(issue, 'notes');

  const editorSections: EditableSectionConfig[] = [
    {
      field: 'title',
      label: t('detail.edit.title'),
      value: issue.title,
    },
    {
      field: 'description',
      headingId: 'detail-description',
      label: t('detail.description'),
      value: issue.description,
      emptyText: t('detail.description.empty'),
      multiline: true,
      previewable: true,
    },
    {
      field: 'acceptance',
      headingId: 'detail-acceptance',
      label: t('detail.acceptance'),
      value: issue.acceptance_criteria ?? '',
      emptyText: t('detail.acceptance.empty'),
      multiline: true,
      className: 'mt-6',
    },
  ];

  const collapsibleFields = [
    { key: 'design' as const, label: t('detail.design'), content: design },
    { key: 'notes' as const, label: t('detail.notes'), content: notes },
  ].filter(
    (item): item is { key: 'design' | 'notes'; label: string; content: string } =>
      item.content !== null
  );

  return (
    <div className="w-full pb-8">
      <div className="px-4 pt-3">
        <DetailToolbar issue={issue} onBack={requestBack} />
      </div>
      <article className="mx-auto w-full max-w-[1100px] px-4 pt-3">
        <Header
          issue={issue}
          hideTitle={editing === 'title'}
          onEditTitle={canEdit ? () => beginEdit('title') : undefined}
        />

        <EditableSection
          config={editorSections[0]!}
          editing={editing}
          canEdit={canEdit}
          pending={pending}
          error={validationError}
          editText={t('detail.edit.edit')}
          onDirtyChange={setFieldDirty}
          onOpenLink={openLink}
          onSave={(next) => saveField('title', next)}
          onCancel={cancelEdit}
          onBeginEdit={() => beginEdit('title')}
        />

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
            {editorSections.slice(1).map((config) => (
              <EditableSection
                key={config.field}
                config={config}
                editing={editing}
                canEdit={canEdit}
                pending={pending}
                error={validationError}
                editText={t('detail.edit.edit')}
                onDirtyChange={setFieldDirty}
                onOpenLink={openLink}
                onSave={(next) => saveField(config.field, next)}
                onCancel={cancelEdit}
                onBeginEdit={() => beginEdit(config.field)}
              />
            ))}

            {collapsibleFields.map(({ key, label, content }) => (
              <CollapsibleField key={key} label={label} content={content} onOpenLink={openLink} />
            ))}

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
    </div>
  );
}

function EditableSection({
  config,
  editing,
  canEdit,
  pending,
  error,
  editText,
  onDirtyChange,
  onOpenLink,
  onSave,
  onCancel,
  onBeginEdit,
}: {
  config: EditableSectionConfig;
  editing: EditableField | null;
  canEdit: boolean;
  pending: boolean;
  error: string | null;
  editText: string;
  onDirtyChange: (dirty: boolean) => void;
  onOpenLink: (url: string) => Promise<void>;
  onSave: (next: string) => Promise<boolean>;
  onCancel: () => void;
  onBeginEdit: () => void;
}) {
  const isEditing = editing === config.field;

  if (config.field === 'title') {
    if (!isEditing) {
      return null;
    }
    return (
      <div className="mt-3">
        <Editor
          label={config.label}
          value={config.value}
          pending={pending}
          disabled={!canEdit}
          error={error}
          onDirtyChange={onDirtyChange}
          onSave={onSave}
          onCancel={onCancel}
        />
      </div>
    );
  }

  const trimmed = config.value.trim();

  return (
    <section aria-labelledby={config.headingId} className={config.className}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={config.headingId} className="text-sm font-semibold">
          {config.label}
        </h2>
        {canEdit && editing === null ? (
          <Button variant="ghost" size="xs" onClick={onBeginEdit} className="text-muted-foreground">
            {editText}
          </Button>
        ) : null}
      </div>
      <div className="mt-2">
        {isEditing ? (
          <Editor
            label={config.label}
            value={config.value}
            multiline={config.multiline}
            previewable={config.previewable}
            pending={pending}
            disabled={!canEdit}
            error={error}
            onDirtyChange={onDirtyChange}
            onOpenLink={onOpenLink}
            onSave={onSave}
            onCancel={onCancel}
          />
        ) : trimmed === '' ? (
          <p className="text-sm text-muted-foreground">{config.emptyText}</p>
        ) : (
          <Markdown onOpenLink={onOpenLink}>{trimmed}</Markdown>
        )}
      </div>
    </section>
  );
}

function CollapsibleField({
  label,
  content,
  onOpenLink,
}: {
  label: string;
  content: string;
  onOpenLink: (url: string) => Promise<void>;
}) {
  return (
    <details className="group mt-6">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-semibold">
        {label}
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="mt-2">
        <Markdown onOpenLink={onOpenLink}>{content}</Markdown>
      </div>
    </details>
  );
}
