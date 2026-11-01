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
  const { snapshot, bd, loading, error, reload, refreshBd } = useWorkspaceContext();

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