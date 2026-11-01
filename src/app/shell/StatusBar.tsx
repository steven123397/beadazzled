import { useI18n } from '@/lib/i18n/I18nProvider';

import { describeSyncState, syncToneClass, useSyncState } from './SyncStatus';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

export function StatusBar() {
  const { t } = useI18n();
  const { snapshot, bd, error } = useWorkspaceContext();
  const sync = useSyncState();
  const { key, tone, vars } = describeSyncState(sync);
  const project = activeWorkspace(snapshot);

  return (
    <footer
      aria-label={t('shell.statusBar')}
      className="flex items-center gap-4 border-t border-border px-3 py-1 text-xs text-muted-foreground"
    >
      <span>
        {bd?.kind === 'ready'
          ? t('status.bdVersion', { version: bd.version })
          : t('status.bdUnknown')}
      </span>
      <span className="truncate">{project?.name ?? t('shell.workspace.none')}</span>
      <span className="min-w-0 flex-1 truncate text-destructive">{error ?? ''}</span>
      <span className={`font-medium ${syncToneClass(tone)}`}>{t(key, vars)}</span>
    </footer>
  );
}
