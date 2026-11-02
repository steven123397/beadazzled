export type DiagnosticsInput = {
  bd: string;
  workspace: string;
  project: string;
  lastSeq: number;
  /** The `SyncState` kind, kept machine-readable for support pastes. */
  sync: string;
  /** ISO timestamp of the last refresh, or null when there has been none. */
  lastRefreshAt: string | null;
  pendingWrites: number;
  error: string | null;
  view: string;
};

/**
 * The clipboard payload behind both "Copy diagnostics" entry points.
 *
 * The shape is fixed on purpose: one `key: value` per line, always the same
 * order, so a pasted report can be diffed. Callers only pass state the shell
 * already holds — nothing here reads the environment, the config file or bd.
 */
export function formatDiagnostics(input: DiagnosticsInput): string {
  return [
    `bd: ${input.bd}`,
    `workspace: ${input.workspace}`,
    `projectId: ${input.project}`,
    `lastSeq: ${input.lastSeq}`,
    `sync: ${input.sync}`,
    `lastRefresh: ${input.lastRefreshAt ?? '-'}`,
    `pendingWrites: ${input.pendingWrites}`,
    `lastError: ${input.error ?? '-'}`,
    `view: ${input.view}`,
  ].join('\n');
}