import { Outlet } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

export function Shell() {
  const { snapshot } = useWorkspaceContext();
  const project = activeWorkspace(snapshot);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <TopBar project={project} />
      <div className="flex min-h-0 flex-1">
        <Sidebar project={project} />
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
