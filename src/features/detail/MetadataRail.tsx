import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PriorityIcon } from '@/components/ui/priority-icon';
import { StatusIcon } from '@/components/ui/status-icon';
import type { Issue, WriteCommand } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import type { IssueIndex } from '@/lib/store/selectors';
import { describeError } from '@/lib/errors';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/time';
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
  const [newLabel, setNewLabel] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const dirty = assigneeDirty || newLabel.trim() !== '';
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
    void submitUpdate({ status: target, ifStatus: issue.status }, `status:${target}`, ['status']);
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
      }
    });
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
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">{t('detail.metadata.status')}</dt>
        <dd>
          {canEdit ? (
            <span className="flex w-full items-center gap-1.5">
              <StatusIcon status={issue.status} />
              <Select
                id="detail-status"
                aria-label={t('detail.metadata.status')}
                value={issue.status}
                disabled={disabled}
                onChange={(event) => changeStatus(event.target.value)}
                className="w-full"
              >
                {statuses.map((status) => {
                  const decision = canChangeStatus(issue, status, blockers);
                  return (
                    <option key={status} value={status} disabled={!decision.allowed}>
                      {statusText(status, t)}
                      {decision.allowed ? '' : ` — ${t('detail.edit.blocked')}`}
                    </option>
                  );
                })}
              </Select>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <StatusIcon status={issue.status} />
              {statusText(issue.status, t)}
            </span>
          )}
        </dd>

        <dt className="text-muted-foreground">{t('detail.metadata.priority')}</dt>
        <dd className="tabular-nums">
          {canEdit ? (
            <Select
              id="detail-priority"
              aria-label={t('detail.metadata.priority')}
              value={String(issue.priority)}
              disabled={disabled}
              onChange={(event) =>
                void submitUpdate(
                  { priority: Number(event.target.value), ifStatus: issue.status },
                  `priority:${event.target.value}`,
                  ['priority']
                )
              }
              className="w-full"
            >
              {(PRIORITIES.includes(issue.priority)
                ? PRIORITIES
                : [...PRIORITIES, issue.priority]
              ).map((priority) => (
                <option key={priority} value={priority}>
                  P{priority}
                </option>
              ))}
            </Select>
          ) : (
            <span className="flex items-center gap-1.5">
              <PriorityIcon priority={issue.priority} />
              {`P${issue.priority}`}
            </span>
          )}
        </dd>

        <dt className="text-muted-foreground">{t('detail.metadata.type')}</dt>
        <dd>{issue.issue_type}</dd>

        <dt className="text-muted-foreground">{t('detail.metadata.assignee')}</dt>
        <dd>
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
        </dd>

        <dt className="text-muted-foreground">{t('detail.metadata.labels')}</dt>
        <dd>
          <div className="flex flex-wrap gap-1">
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
          </div>
          {canEdit ? (
            <div className="mt-1 flex items-center gap-1">
              <Input
                aria-label={t('detail.edit.newLabel')}
                value={newLabel}
                disabled={disabled}
                onChange={(event) => setNewLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addLabel();
                  }
                }}
                className="min-w-0 flex-1"
              />
              <Button size="sm" onClick={addLabel} disabled={disabled || newLabel.trim() === ''}>
                {t('detail.edit.add')}
              </Button>
            </div>
          ) : null}
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
