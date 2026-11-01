import { HashRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';

import type { SyncState } from '@/bindings/bd';
import { workspaceApi as defaultWorkspaceApi, type WorkspaceApi } from '@/lib/workspace/api';
import { useWorkspace } from '@/lib/workspace/useWorkspace';

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
};

export function App({
  workspaceApi = defaultWorkspaceApi,
  syncState = { kind: 'loading', step: 'export' },
}: AppProps) {
  const workspace = useWorkspace(workspaceApi);

  return (
    <ErrorBoundary>
      <SyncStatusProvider state={syncState}>
        <WorkspaceProvider workspace={workspace}>
          <HashRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<RootRedirect />} />
                <Route path="welcome" element={<Welcome />} />
                <Route path="w/:projectId" element={<ProjectGate />}>
                  <Route path="list" element={<Placeholder title="List" />} />
                  <Route path="board" element={<Placeholder title="Board" />} />
                  <Route path="issue/:issueId" element={<IssuePlaceholder />} />
                </Route>
                <Route path="settings" element={<Placeholder title="Settings" />} />
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
