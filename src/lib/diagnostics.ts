export type DiagnosticsInput = {
  /** `null` when the app plugin is unavailable (browser e2e). */
  appVersion: string | null;
  bdVersion: string | null;
  bdPath: string | null;
  workspace: string | null;
  project: string | null;
  doltMode: string | null;
  schema: number | null;
  /** The `SyncState` kind, kept machine-readable for support pastes. */
  sync: string;
  lastSeq: number | null;
  /** ISO timestamp of the last refresh, or null when there has been none. */
  lastRefreshAt: string | null;
  /** `<code> — <message>`, or null. */
  error: string | null;
};

/**
 * The clipboard payload behind both "Copy diagnostics" entry points.
 *
 * The shape is fixed by SPEC-settings: one line per fact, always the same
 * order, so a pasted report can be diffed. Callers only pass state the screen
 * already holds — nothing here reads the environment, the config file or bd.
 * Paths and ticket ids are allowed; tokens and issue bodies never are.
 */
export function formatDiagnostics(input: DiagnosticsInput): string {
  return [
    `beadazzled ${input.appVersion ?? 'unknown'}`,
    `bd ${input.bdVersion ?? 'unknown'} at ${input.bdPath ?? '-'}`,
    `workspace: ${input.workspace ?? '-'}`,
    `project: ${input.project ?? '-'} · dolt_mode=${input.doltMode ?? '-'} · schema=${input.schema ?? '-'}`,
    `sync: ${input.sync} · lastSeq=${input.lastSeq ?? '-'} · lastRefresh=${input.lastRefreshAt ?? '-'}`,
    `error: ${input.error ?? '-'}`,
  ].join('\n');
}