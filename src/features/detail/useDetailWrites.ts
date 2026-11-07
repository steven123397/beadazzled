import { useCallback, useEffect, useRef, useState } from 'react';

import type { Issue } from '@/bindings/bd';
import { setDraftGuard } from '@/lib/draft-guard';
import { describeError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { commentIssue, updateIssue, type UpdateInput } from '@/lib/writes/commands';
import type { UseWrite } from '@/lib/writes/useWrite';

import { changedFields, type DraftField } from './changes';

export type EditableField = 'title' | 'description' | 'acceptance';

export interface UseDetailWritesOptions {
  issue: Issue | undefined;
  writes?: UseWrite;
  loading?: boolean;
  onBack: () => void;
}

export function useDetailWrites({
  issue,
  writes,
  loading,
  onBack,
}: UseDetailWritesOptions) {
  const { t } = useI18n();
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
  const pending = issue !== undefined && (writes?.isPending(issue.id) ?? false);
  const updatedElsewhere = editing !== null && externalUpdate;

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

  const saveField = useCallback(
    async (field: EditableField, next: string): Promise<boolean> => {
      if (issue === undefined) {
        return false;
      }
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
    },
    [issue, noteSelfWrite, t, writes]
  );

  const submitComment = useCallback(
    async (text: string): Promise<boolean> => {
      if (issue === undefined || writes === undefined) {
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
    },
    [issue, noteSelfWrite, t, writes]
  );

  return {
    editing,
    setEditing,
    canEdit,
    pending,
    deleted,
    hasDraft,
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
  };
}
