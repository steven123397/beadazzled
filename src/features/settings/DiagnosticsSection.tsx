import { useState } from 'react';

import { useAppRefresh } from '@/app/shell/AppRefresh';
import { useSyncState } from '@/app/shell/SyncStatus';
import type { BdStatus, DiagnosticsSnapshot } from '@/bindings/bd';
import { Button } from '@/components/ui/button';
import { CopyNotice, useCopy } from '@/components/ui/copy-notice';
import { InfoRow } from '@/components/ui/definition-row';
import { useAppVersion } from '@/lib/app-version';
import { copyText, type CopyResult } from '@/lib/clipboard';
import { formatDiagnostics } from '@/lib/diagnostics';
import { diagnosticsApi as defaultApi, type DiagnosticsApi } from '@/lib/diagnostics/api';
import { messageOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { SettingsSection } from './SettingsSection';

/** The report shows the newest calls only; the buffer keeps 200. */
const SHOWN_CALLS = 20;

export type DiagnosticsSectionProps = {
  api?: DiagnosticsApi;
  copy?: (text: string) => Promise<CopyResult>;
};

/**
 * A copyable report built on demand. Loading it spawns `bd context` once, so
 * the section says so and never runs anything while merely being opened.
 */
export function DiagnosticsSection({ api = defaultApi, copy = copyText }: DiagnosticsSectionProps) {
  const { t } = useI18n();
  const appVersion = useAppVersion();
  const sync = useSyncState();
  const { lastRefreshAt } = useAppRefresh();
  const [report, setReport] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { copyResult, copy: performCopy } = useCopy({ copy });

  async function load(): Promise<DiagnosticsSnapshot | null> {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await api.load();
      setReport(next);
      return next;
    } catch (reason) {
      // A failed reload must not leave the previous report to be copied as if
      // it described the current state.
      setReport(null);
      setLoadError(messageOf(reason));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function copyReport(): Promise<void> {
    const current = report ?? (await load());
    if (current === null) {
      return;
    }
    await performCopy(buildText(current));
  }

  function buildText(snapshot: DiagnosticsSnapshot): string {
    const bd = snapshot.bd;
    const context = snapshot.context;
    return formatDiagnostics({
      appVersion,
      bdVersion: bd.kind === 'ready' ? bd.version : bd.kind,
      bdPath: 'path' in bd ? bd.path : null,
      workspace: snapshot.workspace,
      project: context?.projectId ?? null,
      doltMode: context?.doltMode ?? null,
      schema: context?.schemaVersion ?? null,
      sync: sync.kind,
      lastSeq: sync.kind === 'healthy' ? sync.lastSeq : null,
      lastRefreshAt: new Date(lastRefreshAt).toISOString(),
      // Only the bridge's mapped sentence: raw bd stderr stays on screen.
      error: errorText(snapshot),
    });
  }

  return (
    <SettingsSection id="settings-diagnostics" title={t('settings.diagnostics')}>
      <p className="text-xs text-muted-foreground">{t('settings.diagnostics.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="md" onClick={() => void load()} disabled={loading}>
          {loading ? t('settings.diagnostics.loading') : t('settings.diagnostics.load')}
        </Button>
        <Button size="md" variant="ghost" onClick={() => void copyReport()} disabled={loading}>
          {t('settings.diagnostics.copy')}
        </Button>
      </div>
      {loadError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {loadError}
        </p>
      )}
      <CopyNotice result={copyResult} />
      {report === null ? null : (
        <div className="space-y-3">
          <dl className="space-y-1 rounded-md border border-border bg-raised p-3 text-xs">
            <InfoRow label={t('settings.diagnostics.bd')} value={describeBd(report.bd)} />
            <InfoRow label={t('settings.diagnostics.workspace')} value={report.workspace ?? '-'} />
            {report.context === null ? (
              <p className="text-muted-foreground">
                {report.contextError === null
                  ? t('settings.diagnostics.noContext')
                  : t('settings.diagnostics.contextError', {
                      error: `${report.contextError.code} — ${report.contextError.message}`,
                    })}
              </p>
            ) : (
              <>
                <InfoRow
                  label={t('settings.diagnostics.project')}
                  value={report.context.projectId}
                />
                <InfoRow
                  label={t('settings.diagnostics.doltMode')}
                  value={report.context.doltMode}
                />
                <InfoRow
                  label={t('settings.diagnostics.schema')}
                  value={String(report.context.schemaVersion)}
                />
              </>
            )}
          </dl>
          <div className="space-y-1">
            <h3 className="text-xs font-medium">{t('settings.diagnostics.calls')}</h3>
            {report.calls.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('settings.diagnostics.noCalls')}</p>
            ) : (
              <table
                className="w-full text-left text-xs"
                aria-label={t('settings.diagnostics.calls')}
              >
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-medium">
                      {t('settings.diagnostics.command')}
                    </th>
                    <th scope="col" className="py-1 pr-2 font-medium">
                      {t('settings.diagnostics.argv')}
                    </th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">
                      {t('settings.diagnostics.duration')}
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      {t('settings.diagnostics.result')}
                    </th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {report.calls.slice(0, SHOWN_CALLS).map((call, index) => (
                    <tr key={`${call.command}-${index}`} className="border-t border-border">
                      <td className="py-1 pr-2">{call.command}</td>
                      <td className="max-w-40 truncate py-1 pr-2 text-muted-foreground">
                        {call.argv}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">{call.durationMs}</td>
                      <td className="py-1 text-right">
                        {call.errorCode ?? (call.exitCode === 0 ? 'ok' : String(call.exitCode))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

function describeBd(bd: BdStatus): string {
  switch (bd.kind) {
    case 'ready':
      return `${bd.version} · ${bd.path}`;
    case 'unsupported':
      return `${bd.found} (needs ${bd.min}) · ${bd.path}`;
    case 'broken':
      return `${bd.error.code} · ${bd.path}`;
    case 'not-found':
      return 'not found';
  }
}

function errorText(snapshot: DiagnosticsSnapshot): string | null {
  if (snapshot.contextError !== null) {
    return `${snapshot.contextError.code} — ${snapshot.contextError.message}`;
  }
  return null;
}
