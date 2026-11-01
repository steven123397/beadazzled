import { useI18n } from '@/lib/i18n/I18nProvider';

import { describeSyncState, syncToneClass, useSyncState } from './SyncStatus';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

export function StatusBar({
  lastRefreshAt,
  open,
  onOpen,
}: {
  lastRefreshAt: number;
  open: boolean;
  onOpen: () => void;
}) {
  const { t, language } = useI18n();
  const { snapshot, bd, error } = useWorkspaceContext();
  const sync = useSyncState();
  const { key, tone, vars } = describeSyncState(sync);
  const project = activeWorkspace(snapshot);
  const refreshed = new Intl.DateTimeFormat(language, { timeStyle: 'medium' }).format(
    new Date(lastRefreshAt)
  );

  return (
    <footer aria-label={t('shell.statusBar')} className="border-t border-border text-xs text-muted-foreground">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('status.openDiagnostics')}
        className="flex w-full items-center gap-4 px-3 py-1 text-left"
      >
        <span>
          {bd?.kind === 'ready'
            ? t('status.bdVersion', { version: bd.version })
            : t('status.bdUnknown')}
        </span>
        <span className="truncate">{project?.name ?? t('shell.workspace.none')}</span>
        <span className="truncate">{t('status.refreshed', { time: refreshed })}</span>
        <span className="min-w-0 flex-1 truncate text-destructive">{error ?? ''}</span>
        <span className={`font-medium ${syncToneClass(tone)}`} role="status" aria-live="polite">
          {t(key, vars)}
        </span>
      </button>
    </footer>
  );
}