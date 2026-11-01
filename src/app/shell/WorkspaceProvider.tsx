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

/**
 * The workspace the shell should navigate to, or null when none is active.
 *
 * A registered workspace whose directory no longer exists is not enterable:
 * routing it to its list would render an empty screen as if the data were
 * gone, so it falls through to the welcome screen that explains the reason.
 */
export function activeWorkspace(snapshot: WorkspaceSnapshot | null) {
  if (snapshot === null || snapshot.active === null) {
    return null;
  }
  const workspace = snapshot.config.workspaces.find((entry) => entry.path === snapshot.active);
  if (workspace === undefined || isMissingWorkspace(snapshot, workspace.path)) {
    return null;
  }
  return workspace;
}

/** Registered, but the directory on disk is gone. */
export function isMissingWorkspace(snapshot: WorkspaceSnapshot | null, path: string): boolean {
  return snapshot !== null && snapshot.missing.includes(path);
}
