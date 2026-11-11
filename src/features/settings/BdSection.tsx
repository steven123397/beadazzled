import { useState } from 'react';

import type { BdStatus } from '@/bindings/bd';
import { useWorkspaceContext } from '@/app/shell/WorkspaceProvider';
import { Button } from '@/components/ui/button';
import { CopyNotice, useCopy } from '@/components/ui/copy-notice';
import { copyText, type CopyResult } from '@/lib/clipboard';
import { messageOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { pickBdExecutable as defaultPicker } from './dialog';
import { SettingsSection } from './SettingsSection';

export type BdSectionProps = {
  /** Test seam: the native picker cannot run outside a webview. */
  pickFile?: () => Promise<string | null>;
  copy?: (text: string) => Promise<CopyResult>;
};

/**
 * bd resolution: what was found, where it came from, and the two explicit
 * actions that touch it. Opening the page never probes bd by itself — only
 * "Detect again", "Choose bd…" and "Use the bd on PATH" do.
 */
export function BdSection({ pickFile = defaultPicker, copy = copyText }: BdSectionProps) {
  const { t } = useI18n();
  const { snapshot, bd, error, refreshBd, setBdPath } = useWorkspaceContext();
  const [attempt, setAttempt] = useState<BdStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copyResult, setCopyResult, copy: performCopy } = useCopy({ copy });

  const configured = snapshot?.config.bdPath ?? null;
  // The panel always describes what the app is actually running on. A rejected
  // pick is reported beside it: replacing the effective status would hide a
  // working bd behind install instructions.
  const shown = bd;
  const rejected = attempt === null || attempt.kind === 'ready' ? null : attempt;
  const shownError = actionError ?? error;
  const installCommand = t('welcome.installCommand');

  async function detect(): Promise<void> {
    setBusy(true);
    setAttempt(null);
    setActionError(null);
    try {
      await refreshBd();
    } finally {
      setBusy(false);
    }
  }

  async function choose(): Promise<void> {
    setActionError(null);
    setCopyResult(null);
    let path: string | null;
    try {
      path = await pickFile();
    } catch (error) {
      setActionError(messageOf(error));
      return;
    }
    if (path === null) {
      return;
    }
    setBusy(true);
    try {
      setAttempt(await setBdPath(path));
    } finally {
      setBusy(false);
    }
  }

  async function usePath(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      setAttempt(await setBdPath(null));
    } finally {
      setBusy(false);
    }
  }

  async function copyCommand(): Promise<void> {
    await performCopy(installCommand);
  }

  function describeRejection(status: BdStatus): string {
    switch (status.kind) {
      case 'not-found':
        return t('settings.bd.rejectedNotFound', { path: status.searched[0] ?? '-' });
      case 'unsupported':
        return t('settings.bd.unsupported', { found: status.found, min: status.min });
      case 'broken':
        return t('settings.bd.broken', { path: status.path, error: status.error.message });
      case 'ready':
        return '';
    }
  }

  return (
    <SettingsSection id="settings-bd" title={t('settings.bd')}>
      <div className="space-y-2 rounded-md border border-border bg-raised p-3 text-xs">
        {shown === null ? (
          <p className="text-muted-foreground">{t('settings.bd.loading')}</p>
        ) : shown.kind === 'ready' ? (
          <>
            <p className="font-medium">{t('settings.bd.version', { version: shown.version })}</p>
            <p className="break-all text-muted-foreground">
              {t('settings.bd.pathLine', { path: shown.path })}
            </p>
            <p className="text-muted-foreground">
              {configured === null
                ? t('settings.bd.source.path')
                : t('settings.bd.source.configured')}
            </p>
          </>
        ) : shown.kind === 'unsupported' ? (
          <p className="text-destructive">
            {t('settings.bd.unsupported', { found: shown.found, min: shown.min })}
          </p>
        ) : shown.kind === 'broken' ? (
          <p className="text-destructive">
            {t('settings.bd.broken', { path: shown.path, error: shown.error.message })}
          </p>
        ) : (
          <>
            <p className="text-warning">{t('settings.bd.notFound')}</p>
            <code className="block select-all rounded border border-border bg-muted px-2 py-1 font-mono text-2xs text-foreground">
              {installCommand}
            </code>
            {shown.searched.length > 0 ? (
              <p className="break-all text-muted-foreground">
                {t('settings.bd.lookedIn', { paths: shown.searched.join(', ') })}
              </p>
            ) : null}
          </>
        )}
      </div>
      {rejected === null ? null : (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          <p>{t('settings.bd.rejected')}</p>
          <p>{describeRejection(rejected)}</p>
        </div>
      )}
      {shownError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
      <CopyNotice result={copyResult} />
      <div className="flex flex-wrap gap-2">
        <Button size="md" onClick={() => void detect()} disabled={busy}>
          {t('settings.bd.redetect')}
        </Button>
        <Button size="md" onClick={() => void choose()} disabled={busy}>
          {t('settings.bd.choose')}
        </Button>
        {shown?.kind === 'not-found' ? (
          <Button size="md" variant="ghost" onClick={() => void copyCommand()}>
            {t('settings.bd.copy')}
          </Button>
        ) : null}
        {configured === null ? null : (
          <Button size="md" variant="ghost" onClick={() => void usePath()} disabled={busy}>
            {t('settings.bd.usePath')}
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
