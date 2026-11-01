import { HashRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';

import type { Issue, SyncState } from '@/bindings/bd';
import { workspaceApi as defaultWorkspaceApi, type WorkspaceApi } from '@/lib/workspace/api';
import { useWorkspace } from '@/lib/workspace/useWorkspace';
import { I18nProvider, useI18n } from '@/lib/i18n/I18nProvider';
import type { Language } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import type { Theme } from '@/lib/theme/theme';

import { ErrorBoundary } from './shell/ErrorBoundary';
import { IssuePlaceholder, Placeholder } from './shell/Placeholder';
import { Shell } from './shell/Shell';
import { SkeletonScreen } from './shell/SkeletonScreen';
import { SyncStatusProvider } from './shell/SyncStatus';
import { Welcome } from './shell/Welcome';
import { activeWorkspace, WorkspaceProvider, useWorkspaceContext } from './shell/WorkspaceProvider';

export type AppProps = {
  workspaceApi?: WorkspaceApi;
  /** Wired to the sync engine later; the shell only renders it. */
  syncState?: SyncState;
  /** Palettes search these; the sync engine supplies them later. */
  issues?: readonly Issue[];
  initialLanguage?: Language;
  initialTheme?: Theme;
};

export function App({
  workspaceApi = defaultWorkspaceApi,
  syncState = { kind: 'loading', step: 'export' },
  issues = [],
  initialLanguage,
  initialTheme,
}: AppProps) {
  return (
    <I18nProvider initialLanguage={initialLanguage}>
      <ThemeProvider initialPreference={initialTheme}>
        <AppFrame workspaceApi={workspaceApi} syncState={syncState} issues={issues} />
      </ThemeProvider>
    </I18nProvider>
  );
}

function AppFrame({
  workspaceApi,
  syncState,
  issues,
}: {
  workspaceApi: WorkspaceApi;
  syncState: SyncState;
  issues: readonly Issue[];
}) {
  const { t } = useI18n();
  const workspace = useWorkspace(workspaceApi);

  return (
    <ErrorBoundary title={t('error.title')} copyLabel={t('error.copy')}>
      <SyncStatusProvider state={syncState}>
        <WorkspaceProvider workspace={workspace}>
          <HashRouter>
            <Routes>
              <Route element={<Shell issues={issues} />}>
                <Route index element={<RootRedirect />} />
                <Route path="welcome" element={<Welcome />} />
                <Route path="w/:projectId" element={<ProjectGate />}>
                  <Route path="list" element={<Placeholder titleKey="nav.list" />} />
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

  if (loading) {
    return <SkeletonScreen />;
  }

  const project = activeWorkspace(snapshot);
  if (project === null) {
    return <Navigate to="/welcome" replace />;
  }

  return <Navigate to={`/w/${project.projectId}/list`} replace />;
}

/** A deep link whose projectId is not registered lands on the welcome screen. */
function ProjectGate() {
  const { projectId } = useParams<{ projectId: string }>();
  const { snapshot, loading } = useWorkspaceContext();

  if (loading) {
    return <SkeletonScreen />;
  }

  const project =
    snapshot?.config.workspaces.find((workspace) => workspace.projectId === projectId) ?? null;
  if (project === null) {
    return <Navigate to="/welcome" replace />;
  }

  return <Outlet />;
}
