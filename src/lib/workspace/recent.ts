import type { WorkspaceEntry } from '@/bindings/bd';

const DEFAULT_RECENT_LIMIT = 5;

// Workspaces are registered by their canonical path, but the path can arrive
// with either separator and in any case. The Rust `path_key` applies the same
// normalisation, so both sides agree on identity.
export function workspaceKey(path: string): string {
  const normalised = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const rooted = normalised === '' && path !== '' ? '/' : normalised;
  return rooted.toLowerCase();
}

function openedAt(workspace: WorkspaceEntry): number {
  const parsed = Date.parse(workspace.lastOpenedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** The most recently opened workspaces, newest first. */
export function recentWorkspaces(
  workspaces: readonly WorkspaceEntry[],
  limit = DEFAULT_RECENT_LIMIT
): WorkspaceEntry[] {
  return [...workspaces]
    .sort((left, right) => openedAt(right) - openedAt(left) || left.path.localeCompare(right.path))
    .slice(0, limit);
}

/** Finds a registered workspace by any spelling of its path. */
export function findWorkspace(
  workspaces: readonly WorkspaceEntry[],
  path: string
): WorkspaceEntry | undefined {
  const key = workspaceKey(path);
  return workspaces.find((workspace) => workspaceKey(workspace.path) === key);
}