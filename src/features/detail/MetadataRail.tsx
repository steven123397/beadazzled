import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DefinitionRow } from '@/components/ui/definition-row';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { PopoverSelect } from '@/components/ui/popover-select';
import { PriorityIcon } from '@/components/ui/priority-icon';
import { RelativeTime } from '@/components/ui/relative-time';
import { StatusIcon } from '@/components/ui/status-icon';
import type { Issue, WriteCommand } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import type { IssueIndex } from '@/lib/store/selectors';
import { describeError } from '@/lib/errors';
import { closeIssue, reopenIssue, updateIssue, type UpdateInput } from '@/lib/writes/commands';
import { blockingDeps, canChangeStatus } from '@/lib/writes/guard';
import type { UseWrite } from '@/lib/writes/useWrite';

import { STATUS_ORDER, statusText } from '@/lib/status';
import type { DraftField } from './changes';
import { Dependencies } from './Dependencies';
import { Editor } from './Editor';

const PRIORITIES = [0, 1, 2, 3, 4];

export function MetadataRail({
  issue,
  index,
  onOpenIssue,
  writes,
  onDirtyChange,
  onSelfWrite,
}: {
  issue: Issue;
  index: IssueIndex;
  onOpenIssue?: (id: string) => void;
  writes?: UseWrite;
  /** Reports whether the rail holds unsaved input. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Names the fields this rail is about to write, so the page can tell its
   * own journal echo from an edit made somewhere else. */
  onSelfWrite?: (fields: readonly DraftField[]) => void;
}) {
  const { t, language } = useI18n();
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [assigneeDirty, setAssigneeDirty] = useState(false);
  const [editingLabels, setEditingLabels] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  // A select keeps the clicked value while its write is in flight. If that
  // write fails the issue never changes, so bump an epoch to remount it back
  // on the value that is actually stored.
  const [statusReset, setStatusReset] = useState(0);
  const [priorityReset, setPriorityReset] = useState(0);
  // A failed write remounts the select on the stored value. Remember whether
  // the keyboard was on it so the replacement trigger takes focus back.
  const restoreStatusFocus = useRef(false);
  const restorePriorityFocus = useRef(false);

  useEffect(() => {
    if (restoreStatusFocus.current) {
      restoreStatusFocus.current = false;
      document.getElementById('detail-status')?.focus();
    }
  }, [statusReset]);

  useEffect(() => {
    if (restorePriorityFocus.current) {
      restorePriorityFocus.current = false;
      document.getElementById('detail-priority')?.focus();
    }
  }, [priorityReset]);

  const dirty = assigneeDirty || (editingLabels && newLabel.trim() !== '');
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const pending = writes?.isPending(issue.id) ?? false;
  const canEdit = writes?.canWrite === true;
  const disabled = !canEdit || pending;
  const blockers = blockingDeps(issue.dependencies, (id) => index.byId[id]?.status);
  const statuses = STATUS_ORDER.includes(issue.status)
    ? STATUS_ORDER
    : [...STATUS_ORDER, issue.status];
  const statusOptions = statuses.map((status) => {
    const decision = canChangeStatus(issue, status, blockers);
    return {
      value: status,
      label: decision.allowed
        ? statusText(status, t)
        : `${statusText(status, t)} — ${t('detail.edit.blocked')}`,
      disabled: !decision.allowed,
    };
  });
  const priorities = PRIORITIES.includes(issue.priority)
    ? PRIORITIES
    : [...PRIORITIES, issue.priority];
  const priorityOptions = priorities.map((priority) => ({
    value: String(priority),
    label: `P${priority}`,
  }));

  const submitUpdate = async (
    input: UpdateInput,
    key: string,
    fields: readonly DraftField[]
  ): Promise<boolean> => {
    if (writes === undefined) {
      setLocalError(t('detail.write.unavailable'));
      return false;
    }
    const result = updateIssue(issue.id, input);
    if (!result.ok) {
      setLocalError(result.error.message);
      return false;
    }
    setLocalError(null);
    onSelfWrite?.(fields);
    const outcome = await writes.submit({
      key: `detail:${issue.id}:${key}`,
      issueId: issue.id,
      build: () => result.command,
    });
    if (outcome.status !== 'ok') {
      setLocalError(describeError(outcome.error).message);
      return false;
    }
    return true;
  };

  const changeStatus = (target: string) => {
    if (target === issue.status) {
      return;
    }
    const decision = canChangeStatus(issue, target, blockers);
    if (!decision.allowed) {
      setLocalError(blockedMessage(decision.blockers));
      return;
    }
    void submitUpdate({ status: target, ifStatus: issue.status }, `status:${target}`, [
      'status',
    ]).then((saved) => {
      if (!saved) {
        restoreStatusFocus.current = true;
        setStatusReset((value) => value + 1);
      }
    });
  };

  const saveAssignee = async (next: string): Promise<boolean> => {
    const value = next.trim();
    const saved = await submitUpdate(
      value === ''
        ? { assignee: { clear: true }, ifAssignee: issue.assignee ?? '' }
        : { assignee: { set: value }, ifAssignee: issue.assignee ?? '' },
      `assignee:${value}`,
      ['assignee']
    );
    if (saved) {
      setEditingAssignee(false);
    }
    return saved;
  };

  const addLabel = () => {
    const value = newLabel.trim();
    if (value === '') {
      return;
    }
    void submitUpdate({ addLabels: [value] }, `label:add:${value}`, ['labels']).then((saved) => {
      if (saved) {
        setNewLabel('');
        setEditingLabels(false);
      }
    });
  };

  const cancelLabels = () => {
    setNewLabel('');
    setEditingLabels(false);
  };

  const closeTicket = () => {
    const decision = canChangeStatus(issue, 'closed', blockers);
    if (!decision.allowed) {
      setLocalError(blockedMessage(decision.blockers));
      return;
    }
    void submitCommand(() => closeIssue(issue.id), 'close', ['status']);
  };

  const submitCommand = async (
    build: () => WriteCommand,
    key: string,
    fields: readonly DraftField[]
  ): Promise<boolean> => {
    if (writes === undefined) {
      setLocalError(t('detail.write.unavailable'));
      return false;
    }
    setLocalError(null);
    onSelfWrite?.(fields);
    const outcome = await writes.submit({
      key: `detail:${issue.id}:${key}`,
      issueId: issue.id,
      build,
    });
    if (outcome.status !== 'ok') {
      setLocalError(describeError(outcome.error).message);
      return false;
    }
    return true;
  };

  const blockedMessage = (ids: readonly string[]) =>
    t('detail.edit.blockedByDependencies', { ids: ids.join(', ') });

  return (
    <aside aria-labelledby="detail-metadata" className="min-w-0 text-xs">
      <h2 id="detail-metadata" className="text-sm font-semibold">
        {t('detail.metadata.title')}
      </h2>
      <dl className="mt-2">
        <PropertyRow label={t('detail.metadata.status')}>
          {canEdit ? (
            <span className="flex w-full items-center gap-1.5">
              <StatusIcon status={issue.status} />
              <PopoverSelect
                key={`${issue.status}:${statusReset}`}
                id="detail-status"
                label={t('detail.metadata.status')}
                value={issue.status}
                options={statusOptions}
                size="xs"
                className="w-20"
                triggerClassName="w-full"
                disabled={disabled}
                onChange={changeStatus}
              />
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <StatusIcon status={issue.status} />
              {statusText(issue.status, t)}
            </span>
          )}
        </PropertyRow>

        <PropertyRow label={t('detail.metadata.priority')}>
          {canEdit ? (
            <span className="flex w-full items-center gap-1.5">
              <PriorityIcon priority={issue.priority} />
              <PopoverSelect
                key={`${issue.priority}:${priorityReset}`}
                id="detail-priority"
                label={t('detail.metadata.priority')}
                value={String(issue.priority)}
                options={priorityOptions}
                size="xs"
                className="w-20"
                triggerClassName="w-full"
                disabled={disabled}
                onChange={(next) =>
                  void submitUpdate(
                    { priority: Number(next), ifStatus: issue.status },
                    `priority:${next}`,
                    ['priority']
                  ).then((saved) => {
                    if (!saved) {
                      restorePriorityFocus.current = true;
                      setPriorityReset((value) => value + 1);
                    }
                  })
                }
              />
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <PriorityIcon priority={issue.priority} />
              {`P${issue.priority}`}
            </span>
          )}
        </PropertyRow>

        <PropertyRow label={t('detail.metadata.type')}>{issue.issue_type}</PropertyRow>

        <PropertyRow label={t('detail.metadata.assignee')}>
          {editingAssignee ? (
            <Editor
              label={t('detail.metadata.assignee')}
              value={issue.assignee ?? ''}
              pending={pending}
              disabled={!canEdit}
              error={localError ?? writes?.error ?? null}
              onDirtyChange={setAssigneeDirty}
              onSave={saveAssignee}
              onCancel={() => setEditingAssignee(false)}
            />
          ) : (
            <span className="flex items-center gap-2">
              {issue.assignee === undefined ? (
                <span className="italic text-muted-foreground">{t('list.unassigned')}</span>
              ) : (
                issue.assignee
              )}
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={t('detail.edit.assignee')}
                  disabled={disabled}
                  onClick={() => setEditingAssignee(true)}
                >
                  {t('detail.edit.edit')}
                </Button>
              ) : null}
            </span>
          )}
        </PropertyRow>

        <PropertyRow label={t('detail.metadata.labels')}>
          <div className="flex flex-wrap items-center gap-1">
            {issue.labels.length === 0 ? (
              <span className="text-muted-foreground">{t('detail.metadata.none')}</span>
            ) : (
              issue.labels.map((label, position) => (
                <Badge key={`${label}:${position}`} className="gap-0.5 py-0 pr-0.5">
                  {label}
                  {canEdit ? (
                    <IconButton
                      label={t('detail.edit.removeLabel', { label })}
                      size="xs"
                      disabled={disabled}
                      onClick={() =>
                        void submitUpdate({ removeLabels: [label] }, `label:remove:${label}`, [
                          'labels',
                        ])
                      }
                      className="size-3.5 text-muted-foreground"
                    >
                      ×
                    </IconButton>
                  ) : null}
                </Badge>
              ))
            )}
            {canEdit && !editingLabels ? (
              <Button
                variant="ghost"
                size="xs"
                aria-label={t('detail.edit.labels')}
                disabled={disabled}
                onClick={() => setEditingLabels(true)}
              >
                {t('detail.edit.edit')}
              </Button>
            ) : null}
          </div>
          {canEdit && editingLabels ? (
            <div className="mt-1">
              <Input
                aria-label={t('detail.edit.newLabel')}
                value={newLabel}
                disabled={disabled}
                autoFocus
                onChange={(event) => setNewLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addLabel();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelLabels();
                  }
                }}
                className="h-control-md"
              />
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={addLabel}
                  disabled={disabled || newLabel.trim() === ''}
                >
                  {t('detail.edit.add')}
                </Button>
                <Button variant="secondary" onClick={cancelLabels} disabled={pending}>
                  {t('detail.edit.cancel')}
                </Button>
              </div>
            </div>
          ) : null}
        </PropertyRow>

        <PropertyRow label={t('detail.metadata.created')}>
          <RelativeTime value={issue.created_at} language={language} />
        </PropertyRow>

        <PropertyRow label={t('detail.metadata.updated')}>
          <RelativeTime value={issue.updated_at} language={language} />
        </PropertyRow>

        {issue.closed_at === undefined ? null : (
          <PropertyRow label={t('detail.metadata.closed')}>
            <RelativeTime value={issue.closed_at} language={language} />
          </PropertyRow>
        )}
      </dl>

      {(localError ?? null) === null ? null : (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {localError}
        </p>
      )}

      {canEdit ? (
        <div className="mt-3 flex gap-2">
          {issue.status === 'closed' ? (
            <Button
              disabled={disabled}
              onClick={() => void submitCommand(() => reopenIssue(issue.id), 'reopen', ['status'])}
            >
              {t('detail.reopen')}
            </Button>
          ) : (
            <Button
              disabled={disabled || !canChangeStatus(issue, 'closed', blockers).allowed}
              onClick={closeTicket}
            >
              {t('detail.close')}
            </Button>
          )}
        </div>
      ) : null}

      <Dependencies issue={issue} index={index} onOpenIssue={onOpenIssue} />
    </aside>
  );
}

/** Every property row shares one label column and a 32px vertical rhythm. */
function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DefinitionRow variant="grid" label={label}>
      {children}
    </DefinitionRow>
  );
}

