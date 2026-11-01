import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import type { BdStatus, WorkspaceSnapshot } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { SkeletonScreen } from './SkeletonScreen';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

type WelcomeReason = 'workspace-missing' | 'switch-failed';

/** Explains why the app cannot open a workspace, instead of showing a blank screen. */
export function Welcome() {
  const { t } = useI18n();
  const location = useLocation();
  const reason = welcomeReason(location.state);
  const { snapshot, bd, loading, error, reload, refreshBd, add, switchTo } = useWorkspaceContext();
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) {
    return <SkeletonScreen />;
  }

  const project = activeWorkspace(snapshot);
  // A direct #/welcome with a ready workspace is a stale route, not a blocker.
  // Keep the reason/error path visible: a failed switch must not bounce the
  // user back into the old workspace.
  if (project !== null && reason === null && error === null) {
    return <Navigate to={`/w/${project.projectId}/list`} replace />;
  }

  return (
    <section aria-labelledby="welcome-title" className="mx-auto max-w-xl space-y-3 p-8">
      <h1 id="welcome-title" className="text-xl font-semibold">
        {t('welcome.title')}
      </h1>
      <p className="text-sm text-muted-foreground">
        {blockerReason(t, snapshot, bd, error, reason)}
      </p>
      {snapshot !== null && snapshot.missing.length > 0 ? (
        <p className="text-sm text-warning">
          {t('welcome.missingWorkspaces', { paths: snapshot.missing.join(', ') })}
        </p>
      ) : null}
      {snapshot?.corruptBackup !== null && snapshot?.corruptBackup !== undefined ? (
        <p className="text-sm text-warning">
          {t('welcome.corruptBackup', { path: snapshot.corruptBackup })}
        </p>
      ) : null}
      {bd?.kind === 'not-found' ? (
        <code className="block select-all rounded border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">
          {t('welcome.installCommand')}
        </code>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void reload();
          void refreshBd();
        }}
        className="rounded border border-border px-3 py-1 text-sm text-foreground"
      >
        {t('welcome.retry')}
      </button>

      <section aria-labelledby="welcome-workspace" className="space-y-2 border-t border-border pt-3">
        <h2 id="welcome-workspace" className="text-sm font-medium">
          {t('welcome.choose')}
        </h2>
        {bd !== null && bd.kind !== 'ready' ? (
          <p className="text-xs text-muted-foreground">{t('welcome.bdNotReady')}</p>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const candidate = path.trim();
            if (candidate === '' || busy || bd?.kind !== 'ready') {
              return;
            }
            setBusy(true);
            void add(candidate).then(() => setBusy(false));
          }}
        >
          <label htmlFor="workspace-path" className="sr-only">
            {t('welcome.pathPlaceholder')}
          </label>
          <input
            id="workspace-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={t('welcome.pathPlaceholder')}
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
          />
          <button
            type="submit"
            disabled={busy || path.trim() === '' || bd?.kind !== 'ready'}
            className="rounded border border-border px-3 py-1 text-sm text-foreground disabled:opacity-50"
          >
            {t('welcome.add')}
          </button>
        </form>
        {snapshot !== null && snapshot.config.workspaces.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('welcome.recent')}
            </p>
            <ul className="space-y-1">
              {snapshot.config.workspaces.map((workspace) => {
                const gone = snapshot.missing.includes(workspace.path);
                return (
                  <li key={workspace.path}>
                    <button
                      type="button"
                      onClick={() => {
                        setBusy(true);
                        void switchTo(workspace.path).then(() => setBusy(false));
                      }}
                      disabled={busy || gone}
                      className="flex w-full items-baseline justify-between gap-3 rounded border border-border px-2 py-1 text-left text-sm text-foreground disabled:opacity-50"
                    >
                      <span>{workspace.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {gone ? t('shell.workspace.missing') : workspace.path}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>
    </section>
  );
}

type T = ReturnType<typeof useI18n>['t'];

function blockerReason(
  t: T,
  snapshot: WorkspaceSnapshot | null,
  bd: BdStatus | null,
  error: string | null,
  reason: WelcomeReason | null
): string {
  if (error !== null) {
    return error;
  }
  if (reason === 'workspace-missing') {
    return t('welcome.workspaceMissing');
  }
  if (reason === 'switch-failed') {
    return t('welcome.switchFailed');
  }
  if (bd === null) {
    return t('welcome.checking');
  }
  switch (bd.kind) {
    case 'ready':
      return activeWorkspace(snapshot) === null ? t('welcome.noWorkspace') : t('welcome.loading');
    case 'not-found':
      return t('welcome.bdMissing');
    case 'unsupported':
      return t('welcome.bdUnsupported', { found: bd.found, min: bd.min });
    case 'broken':
      return bd.error.message;
  }
}

function welcomeReason(state: unknown): WelcomeReason | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }
  const reason = (state as { reason?: unknown }).reason;
  return reason === 'workspace-missing' || reason === 'switch-failed' ? reason : null;
}