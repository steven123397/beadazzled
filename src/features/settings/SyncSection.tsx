import { useAppRefresh } from '@/app/shell/AppRefresh';
import { useSyncErrorHistory, useSyncState } from '@/app/shell/SyncStatus';
import { useWorkspaceContext } from '@/app/shell/WorkspaceProvider';
import { Button } from '@/components/ui/button';
import { CopyNotice, useCopy } from '@/components/ui/copy-notice';
import { InfoRow } from '@/components/ui/definition-row';
import { copyText, type CopyResult } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { describeSyncState } from '@/lib/sync/labels';
import { formatDateTime } from '@/lib/time';

import { SettingsSection } from './SettingsSection';

const JOURNAL_COMMAND = 'bd config set events-journal true';

/**
 * What sync is doing right now, and the two things a user can do about it:
 * enable the journal when it is off, or refresh once.
 */
export function SyncSection({ copy = copyText }: { copy?: (text: string) => Promise<CopyResult> }) {
  const { t, language } = useI18n();
  const sync = useSyncState();
  const lastError = useSyncErrorHistory();
  const { lastRefreshAt, refresh } = useAppRefresh();
  const { snapshot } = useWorkspaceContext();
  const { copyResult, copy: performCopy } = useCopy({ copy });

  const label = describeSyncState(sync);
  const active = snapshot?.config.workspaces.find((entry) => entry.path === snapshot.active);
  const checkpoint = active?.checkpoint ?? null;
  const lastSeq = sync.kind === 'healthy' ? sync.lastSeq : null;
  const lastEventAt = sync.kind === 'healthy' ? sync.lastEventAt : null;
  // A live failure wins; otherwise the remembered one keeps its timestamp.
  const activePath = snapshot?.active ?? null;
  // A remembered failure belongs to the workspace that produced it.
  const historyError = lastError !== null && lastError.workspace === activePath ? lastError : null;
  const shownError =
    sync.kind === 'bd-unavailable' ? { ...sync.error, at: historyError?.at ?? null } : historyError;

  return (
    <SettingsSection id="settings-sync" title={t('settings.sync')}>
      <dl className="space-y-1 rounded-md border border-border bg-raised p-3 text-xs">
        <InfoRow label={t('settings.sync.state')} value={t(label.key, label.vars)} />
        <InfoRow
          label={t('settings.sync.lastSeq')}
          value={lastSeq === null ? '-' : String(lastSeq)}
        />
        <InfoRow
          label={t('settings.sync.lastRefresh')}
          value={formatDateTime(new Date(lastRefreshAt).toISOString(), language)}
        />
        <InfoRow
          label={t('settings.sync.checkpoint')}
          value={
            checkpoint === null
              ? t('settings.sync.checkpointNone')
              : `${checkpoint.seq} · ${formatDateTime(checkpoint.savedAt, language)}`
          }
        />
        {lastEventAt === null ? null : (
          <InfoRow
            label={t('settings.sync.lastEvent')}
            value={formatDateTime(lastEventAt, language)}
          />
        )}
      </dl>
      {shownError === null ? null : (
        <div className="space-y-1 text-xs">
          <p className="text-destructive">
            {t(
              sync.kind === 'bd-unavailable'
                ? 'settings.sync.bdUnavailable'
                : 'settings.sync.lastError'
            )}
          </p>
          {shownError.at === null ? null : (
            <p className="text-muted-foreground">
              {t('settings.sync.lastErrorAt', {
                time: formatDateTime(new Date(shownError.at).toISOString(), language),
              })}
            </p>
          )}
          <p className="font-mono text-destructive">
            {shownError.code} — {shownError.message}
          </p>
          {shownError.detail === undefined ? null : (
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                {t('settings.sync.details')}
              </summary>
              <pre className="mt-1 overflow-auto rounded border border-border bg-muted p-2 text-2xs text-foreground">
                {JSON.stringify(shownError.detail, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
      {sync.kind === 'journal-disabled' ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="text-warning">{t('settings.sync.journalOff')}</p>
          <p className="text-muted-foreground">{t('settings.sync.journalHint')}</p>
          <code className="block select-all rounded border border-border bg-muted px-2 py-1 font-mono text-2xs text-foreground">
            {JOURNAL_COMMAND}
          </code>
          <Button size="md" variant="ghost" onClick={() => void performCopy(JOURNAL_COMMAND)}>
            {t('settings.sync.copyCommand')}
          </Button>
          <CopyNotice result={copyResult} />
        </div>
      ) : null}
      <Button size="md" onClick={refresh}>
        {t('settings.sync.refresh')}
      </Button>
    </SettingsSection>
  );
}
