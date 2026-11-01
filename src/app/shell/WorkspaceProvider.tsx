import { createContext, useContext, type ReactNode } from 'react';

import type { WorkspaceSnapshot } from '@/bindings/bd';
import type { UseWorkspace } from '@/lib/workspace/useWorkspace';

const WorkspaceContext = createContext<UseWorkspace | null>(null);

export function WorkspaceProvider({
  workspace,
  children,
}: {
  workspace: UseWorkspace;
  children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext(): UseWorkspace {
  const value = useContext(WorkspaceContext);
  if (value === null) {
    throw new Error('useWorkspaceContext must be used inside WorkspaceProvider');
  }
  return value;
}

/** The workspace the shell should navigate to, or null when none is active. */
export function activeWorkspace(snapshot: WorkspaceSnapshot | null) {
  if (snapshot === null || snapshot.active === null) {
    return null;
  }
  return snapshot.config.workspaces.find((workspace) => workspace.path === snapshot.active) ?? null;
}
