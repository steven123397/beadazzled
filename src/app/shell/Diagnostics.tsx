import { useRef } from 'react';

import { useFocusTrap } from '@/app/keyboard/useFocusTrap';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { describeSyncState, useSyncState } from './SyncStatus';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

/**
 * What the shell knows about itself, without asking bd anything.
 *
 * Opening this panel is a pure read of the workspace snapshot and the sync
 * store: `bd` costs 1.0–1.4s per call, so a diagnostic view that refreshed it
 * would make the app feel broken exactly when someone is investigating.
 */
export function Diagnostics({
  lastSeq,
  lastRefreshAt,
  pendingWrites,
  onCopy,
  onClose,
}: {
  lastSeq: number;
  lastRefreshAt: number;
  pendingWrites: number;
  onCopy: () => void;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const { snapshot, bd, error } = useWorkspaceContext();
  const sync = useSyncState();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const project = activeWorkspace(snapshot);
  const syncLabel = describeSyncState(sync);
  const refreshed = new Intl.DateTimeFormat(language, { timeStyle: 'medium' }).format(
    new Date(lastRefreshAt)
  );
  const version = bd?.kind === 'ready' ? bd.version : (bd?.kind ?? 'unknown');

  return (
    <div
      data-diagnostics-backdrop
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-lg border border-border bg-raised p-4 text-foreground shadow-lg"
      >
        <h2 id="diagnostics-title" className="text-base font-semibold">
          {t('diagnostics.title')}
        </h2>
        <div className="space-y-1 font-mono text-xs">
          <p>{t('diagnostics.bd', { version })}</p>
          <p>{t('diagnostics.workspace', { path: project?.path ?? '-' })}</p>
          <p>{t('diagnostics.project', { id: project?.projectId ?? '-' })}</p>
          <p>{t('diagnostics.lastSeq', { seq: lastSeq })}</p>
          <p>{t('diagnostics.sync', { state: t(syncLabel.key, syncLabel.vars) })}</p>
          <p>{t('diagnostics.lastRefresh', { time: refreshed })}</p>
          <p>{t('diagnostics.pending', { count: pendingWrites })}</p>
          <p>{t('diagnostics.lastError', { error: error ?? '-' })}</p>
          {snapshot !== null && snapshot.missing.length > 0 ? (
            <p className="text-warning">
              {t('diagnostics.missing', { paths: snapshot.missing.join(', ') })}
            </p>
          ) : null}
          {snapshot?.corruptBackup ? (
            <p className="text-warning">
              {t('diagnostics.corruptBackup', { path: snapshot.corruptBackup })}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCopy}
            className="rounded border border-border px-3 py-1 text-xs text-foreground"
          >
            {t('diagnostics.copy')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            {t('diagnostics.close')}
          </button>
        </div>
      </div>
    </div>
  );
}