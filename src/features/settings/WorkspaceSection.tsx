import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { WorkspaceEntry } from '@/bindings/bd';
import { useWorkspaceContext } from '@/app/shell/WorkspaceProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { messageOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { formatRelativeTime } from '@/lib/time';

import { pickDirectory as defaultPicker } from './dialog';
import { SettingsSection } from './SettingsSection';

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
      // Switch may revalidate the project identity (the directory can now hold
      // a different beads project), so the route is resolved from the refreshed
      // registry instead of the entry captured before the switch.
      navigate('/');
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
    <SettingsSection
      id="settings-workspaces"
      title={
        <>
          {t('settings.workspaces')}
          {workspaces.length > 0 ? (
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
              {workspaces.length}
            </span>
          ) : null}
        </>
      }
      headerAction={
        <Button size="md" onClick={() => void addWorkspace()} disabled={busy}>
          {t('settings.workspaces.add')}
        </Button>
      }
    >
      {shownError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
      {workspaces.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('settings.workspaces.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-raised">
          {workspaces.map((entry) => {
            const isActive = entry.path === active;
            const isMissing = missing.has(entry.path);
            return (
              <li
                key={entry.path}
                className="group flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{entry.name}</span>
                    {isActive ? (
                      <Badge variant="accent">{t('settings.workspaces.current')}</Badge>
                    ) : null}
                    {entry.isWorktree ? <Badge>{t('settings.workspaces.worktree')}</Badge> : null}
                    {isMissing ? (
                      <Badge variant="danger">{t('settings.workspaces.missing')}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 flex min-w-0 items-center gap-1 text-muted-foreground">
                    <span className="truncate" title={entry.path}>
                      {entry.path}
                    </span>
                    <span className="shrink-0">
                      · {t('settings.workspaces.project', { id: shortId(entry.projectId) })}
                    </span>
                    <span className="shrink-0">
                      ·{' '}
                      {t('settings.workspaces.lastOpened', {
                        time: formatRelativeTime(entry.lastOpenedAt, language),
                      })}
                    </span>
                  </p>
                </div>
                {/* The row stays quiet until pointed at; keyboard focus reveals
                    the same actions, so tabbing never hides them. */}
                <div className="flex shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Button onClick={() => void openWorkspace(entry)} disabled={busy || isMissing}>
                    {t('settings.workspaces.open')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void relocateWorkspace(entry)}
                    disabled={busy}
                  >
                    {t('settings.workspaces.relocate')}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(entry)} disabled={busy}>
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
    </SettingsSection>
  );
}

function shortId(projectId: string): string {
  return projectId.length > 8 ? projectId.slice(0, 8) : projectId;
}
