/**
 * Canonical route paths for workspace views.
 *
 * Used across the shell, sidebar, welcome screen, palette commands, and detail view
 * so route literals never drift.
 */

export function listPath(projectId: string): string {
  return `/w/${projectId}/list`;
}

export function boardPath(projectId: string): string {
  return `/w/${projectId}/board`;
}

export function issuePath(projectId: string, issueId: string): string {
  return `/w/${projectId}/issue/${encodeURIComponent(issueId)}`;
}

export function isIssuePath(pathname: string): boolean {
  return /^\/w\/[^/]+\/issue\//.test(pathname);
}
