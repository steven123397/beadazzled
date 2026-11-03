import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { WorkspaceEntry } from '@/bindings/bd';
import { useWorkspaceContext } from '@/app/shell/WorkspaceProvider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { messageOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { formatRelativeTime } from '@/lib/time';

import { pickDirectory as defaultPicker } from './dialog';

export type WorkspaceSectionProps = {
  /** Test seam: the native picker cannot run outside a webview. */
  pickDirectory?: () => Promise<string | null>;
};

/**
 * Registered workspaces and the four operations on them. Removing only drops
 * the registry entry — the repository on disk is never touched.
 */
export function WorkspaceSection({ pickDirectory = defaultPicker }: WorkspaceSectionProps) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const { snapshot, error, add, switchTo, remove, relocate } = useWorkspaceContext();
  const [confirming, setConfirming] = useState<WorkspaceEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const workspaces = snapshot?.config.workspaces ?? [];
  const active = snapshot?.active ?? null;
  const missing = new Set(snapshot?.missing ?? []);

  async function pick(): Promise<string | null> {
    try {
      return await pickDirectory();
    } catch (reason) {
      setLocalError(messageOf(reason));
      return null;
    }
  }

  async function addWorkspace(): Promise<void> {
    setLocalError(null);
    const path = await pick();
    if (path === null) {
      return;
    }
    setBusy(true);
    try {
      await add(path);
    } finally {
      setBusy(false);
    }
  }

  async function openWorkspace(entry: WorkspaceEntry): Promise<void> {
    setLocalError(null);
    setBusy(true);
    try {
      if (entry.path !== active && !(await switchTo(entry.path))) {
        return;
      }
      navigate(`/w/${entry.projectId}/list`);
    } finally {
      setBusy(false);
    }
  }

  async function relocateWorkspace(entry: WorkspaceEntry): Promise<void> {
    setLocalError(null);
    const path = await pick();
    if (path === null) {
      return;
    }
    setBusy(true);
    try {
      await relocate(entry.path, path);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove(): Promise<void> {
    const entry = confirming;
    setConfirming(null);
    if (entry === null) {
      return;
    }
    setBusy(true);
    try {
      await remove(entry.path);
    } finally {
      setBusy(false);
    }
  }

  const shownError = localError ?? error;

  return (
    <section aria-labelledby="settings-workspaces" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="settings-workspaces" className="text-sm font-semibold">
          {t('settings.workspaces')}
        </h2>
        <Button onClick={() => void addWorkspace()} disabled={busy}>
          {t('settings.workspaces.add')}
        </Button>
      </div>
      {shownError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
      {workspaces.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('settings.workspaces.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {workspaces.map((entry) => {
            const isActive = entry.path === active;
            const isMissing = missing.has(entry.path);
            return (
              <li key={entry.path} className="flex flex-wrap items-center gap-2 p-3 text-xs">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{entry.name}</span>
                    {isActive ? (
                      <span className="rounded bg-muted px-1 text-2xs text-foreground">
                        {t('settings.workspaces.current')}
                      </span>
                    ) : null}
                    {entry.isWorktree ? (
                      <span className="rounded bg-muted px-1 text-2xs text-muted-foreground">
                        {t('settings.workspaces.worktree')}
                      </span>
                    ) : null}
                    {isMissing ? (
                      <span className="rounded bg-destructive/10 px-1 text-2xs text-destructive">
                        {t('settings.workspaces.missing')}
                      </span>
                    ) : null}
                  </div>
                  <p className="break-all text-muted-foreground">{entry.path}</p>
                  <p className="text-muted-foreground">
                    {t('settings.workspaces.project', { id: shortId(entry.projectId) })} ·{' '}
                    {t('settings.workspaces.lastOpened', {
                      time: formatRelativeTime(entry.lastOpenedAt, language),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="xs"
                    onClick={() => void openWorkspace(entry)}
                    disabled={busy || isMissing}
                  >
                    {t('settings.workspaces.open')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void relocateWorkspace(entry)}
                    disabled={busy}
                  >
                    {t('settings.workspaces.relocate')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setConfirming(entry)}
                    disabled={busy}
                  >
                    {t('settings.workspaces.remove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {confirming === null ? null : (
        <ConfirmDialog
          title={t('settings.workspaces.confirmTitle')}
          confirmLabel={t('settings.workspaces.remove')}
          cancelLabel={t('settings.workspaces.cancel')}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setConfirming(null)}
        >
          {t('settings.workspaces.confirmBody', { name: confirming.name })}
        </ConfirmDialog>
      )}
    </section>
  );
}

function shortId(projectId: string): string {
  return projectId.length > 8 ? projectId.slice(0, 8) : projectId;
}
