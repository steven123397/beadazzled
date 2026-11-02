import { useCallback, useEffect, useRef, useState } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';

import type { BdStatus, Issue, SyncState } from '@/bindings/bd';
import { ListRoute } from '@/features/list/ListView';
import { workspaceApi as defaultWorkspaceApi, type WorkspaceApi } from '@/lib/workspace/api';
import { useWorkspace } from '@/lib/workspace/useWorkspace';
import { I18nProvider, useI18n } from '@/lib/i18n/I18nProvider';
import type { Language } from '@/lib/i18n';
import type { SyncApi } from '@/lib/sync/api';
import { useSync } from '@/lib/sync/useSync';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import type { Theme } from '@/lib/theme/theme';

import { ErrorBoundary } from './shell/ErrorBoundary';
import { IssuePlaceholder, Placeholder } from './shell/Placeholder';
import { Shell } from './shell/Shell';
import { SkeletonScreen } from './shell/SkeletonScreen';
import { SyncStatusProvider } from './shell/SyncStatus';
import { Welcome } from './shell/Welcome';
import {
  activeWorkspace,
  isMissingWorkspace,
  WorkspaceProvider,
  useWorkspaceContext,
} from './shell/WorkspaceProvider';

export type AppProps = {
  workspaceApi?: WorkspaceApi;
  /** Wired to the sync engine later; the shell only renders it. */
  syncState?: SyncState;
  /** Palettes search these; the sync engine supplies them later. */
  issues?: readonly Issue[];
  initialLanguage?: Language;
  initialTheme?: Theme;
  /**
   * Production enables the Tauri sync worker; unit tests and the browser e2e
   * seam inject `issues`/`syncState` instead and leave this false.
   */
  syncEnabled?: boolean;
  syncApi?: SyncApi;
};

/** Stable defaults: a fresh array/object per render would invalidate memos. */
const NO_ISSUES: readonly Issue[] = [];
const LOADING: SyncState = { kind: 'loading', step: 'export' };

/**
 * The sync worker never starts while bd is not ready, so it cannot produce a
 * `bd-unavailable` state on its own. Map a resolved non-ready bd status here;
 * otherwise the list would show its loading skeleton forever.
 */
function bdUnavailable(bd: BdStatus | null): SyncState | null {
  if (bd === null || bd.kind === 'ready') {
    return null;
  }
  switch (bd.kind) {
    case 'not-found':
      return {
        kind: 'bd-unavailable',
        error: { code: 'BD_NOT_FOUND', message: 'bd was not found on PATH.' },
      };
    case 'unsupported':
      return {
        kind: 'bd-unavailable',
        error: {
          code: 'BD_VERSION_UNSUPPORTED',
          message: `bd ${bd.found} is older than ${bd.min}.`,
        },
      };
    case 'broken':
      return { kind: 'bd-unavailable', error: bd.error };
  }
}

export function App({
  workspaceApi = defaultWorkspaceApi,
  syncState = LOADING,
  issues = NO_ISSUES,
  initialLanguage,
  initialTheme,
  syncEnabled = false,
  syncApi,
}: AppProps) {
  return (
    <I18nProvider initialLanguage={initialLanguage}>
      <ThemeProvider initialPreference={initialTheme}>
        <AppFrame
          workspaceApi={workspaceApi}
          syncState={syncState}
          issues={issues}
          syncEnabled={syncEnabled}
          syncApi={syncApi}
        />
      </ThemeProvider>
    </I18nProvider>
  );
}

function AppFrame({
  workspaceApi,
  syncState,
  issues,
  syncEnabled,
  syncApi,
}: {
  workspaceApi: WorkspaceApi;
  syncState: SyncState;
  issues: readonly Issue[];
  syncEnabled: boolean;
  syncApi?: SyncApi;
}) {
  const { t } = useI18n();
  const workspace = useWorkspace(workspaceApi);
  const { reload, snapshot, bd } = workspace;
  const project = activeWorkspace(snapshot);
  const sync = useSync({
    workspace: project?.path ?? null,
    ready: bd?.kind === 'ready',
    enabled: syncEnabled,
    api: syncApi,
  });
  const shellIssues = syncEnabled ? sync.issues : issues;
  const shellSyncState = syncEnabled ? (bdUnavailable(bd) ?? sync.state) : syncState;
  // The injected state is what unit tests and the browser e2e seam provide.
  const shellLastSeq = syncEnabled
    ? sync.lastSeq
    : syncState.kind === 'healthy'
      ? syncState.lastSeq
      : 0;
  const refresh = useCallback(() => {
    void reload();
    sync.refresh();
  }, [reload, sync.refresh]);

  return (
    <ErrorBoundary
      title={t('error.title')}
      copyLabel={t('error.copy')}
      copiedLabel={t('clipboard.copied')}
      failedLabel={t('clipboard.failed')}
    >
      <SyncStatusProvider state={shellSyncState}>
        <WorkspaceProvider workspace={workspace}>
          <HashRouter>
            <Routes>
              <Route
                element={<Shell issues={shellIssues} onRefresh={refresh} lastSeq={shellLastSeq} />}
              >
                <Route index element={<RootRedirect />} />
                <Route path="welcome" element={<Welcome />} />
                <Route path="w/:projectId" element={<ProjectGate />}>
                  <Route index element={<Navigate to="list" replace />} />
                  <Route
                    path="list"
                    element={
                      <ListRoute
                        issues={shellIssues}
                        syncState={shellSyncState}
                        onRefresh={refresh}
                      />
                    }
                  />
                  <Route path="board" element={<Placeholder titleKey="nav.board" />} />
                  <Route path="issue/:issueId" element={<IssuePlaceholder />} />
                </Route>
                <Route path="settings" element={<Placeholder titleKey="nav.settings" />} />
                <Route path="*" element={<Navigate to="/welcome" replace />} />
              </Route>
            </Routes>
          </HashRouter>
        </WorkspaceProvider>
      </SyncStatusProvider>
    </ErrorBoundary>
  );
}

/** `#/` opens the last workspace, or the welcome screen when there is none. */
function RootRedirect() {
  const { snapshot, loading } = useWorkspaceContext();

  // Only the first load has no snapshot to render; a refresh keeps the current
  // view mounted instead of tearing it down and losing scroll and selection.
  if (loading && snapshot === null) {
    return <SkeletonScreen />;
  }

  const project = activeWorkspace(snapshot);
  if (project === null) {
    return (
      <Navigate
        to="/welcome"
        replace
        state={
          snapshot !== null && snapshot.active !== null
            ? { reason: 'workspace-missing' }
            : undefined
        }
      />
    );
  }

  return <Navigate to={`/w/${project.projectId}/list`} replace />;
}

/** A deep link whose projectId is not registered lands on the welcome screen. */
function ProjectGate() {
  const { projectId } = useParams<{ projectId: string }>();
  const { snapshot, loading, switchTo } = useWorkspaceContext();
  const [switching, setSwitching] = useState(false);
  const attempted = useRef<string | null>(null);

  const project =
    snapshot?.config.workspaces.find((workspace) => workspace.projectId === projectId) ?? null;
  const isActive = project !== null && snapshot?.active === project.path;
  // A workspace whose directory was deleted must not be opened: switching to it
  // would only fail, and the route would render an empty list as if it existed.
  const missing = project !== null && isMissingWorkspace(snapshot, project.path);

  useEffect(() => {
    if (loading || project === null || isActive || switching || missing) {
      return;
    }
    if (attempted.current === project.path) {
      return;
    }
    attempted.current = project.path;
    setSwitching(true);
    void switchTo(project.path).then((ok) => {
      setSwitching(false);
      // On success the snapshot reload makes isActive true. A false result (or
      // a reload failure) leaves the mismatch visible below instead of looping.
      if (!ok) {
        attempted.current = project.path;
      }
    });
  }, [isActive, loading, project, switchTo, switching]);

  if (loading && snapshot === null) {
    return <SkeletonScreen />;
  }

  if (project === null || missing) {
    return <Navigate to="/welcome" replace state={{ reason: 'workspace-missing' }} />;
  }

  if (!isActive) {
    if (switching || attempted.current !== project.path) {
      return <SkeletonScreen />;
    }
    return <Navigate to="/welcome" replace state={{ reason: 'switch-failed' }} />;
  }

  return <Outlet />;
}
