import type { Page } from '@playwright/test';

export type FakeBridgeOptions = {
  projectId?: string;
  name?: string;
  issues?: readonly Record<string, unknown>[];
  syncState?: Record<string, unknown>;
  theme?: 'light' | 'dark' | 'system';
  language?: 'en' | 'zh-CN';
  /** False renders the no-workspace welcome state. */
  active?: boolean;
  /** Extra registered workspaces; the default one is still added first. */
  workspaces?: readonly {
    path: string;
    name: string;
    projectId: string;
    isWorktree?: boolean;
  }[];
  /** What the native picker returns; null means the user cancelled. */
  dialogPath?: string | null;
  /** Overrides the bd resolution result, e.g. `{ kind: 'not-found' }`. */
  bdStatus?: Record<string, unknown>;
};

/**
 * Stands in for the Tauri commands in a browser page: the workspace and bd
 * commands resolve from fixtures, every call is recorded on
 * `window.__invokeLog`, and tickets are handed to the shell through the
 * dev-only e2e seam.
 */
export async function installFakeBridge(
  page: Page,
  options: FakeBridgeOptions = {}
): Promise<void> {
  const {
    projectId = 'p1',
    name = 'alpha',
    issues = [
      {
        id: 'bza-1',
        title: 'Detail reading',
        description: '',
        status: 'open',
        priority: 2,
        issue_type: 'task',
        created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-01T00:00:00Z',
        labels: [],
        dependency_count: 0,
        dependent_count: 0,
        comment_count: 0,
      },
    ],
    syncState,
    theme,
    language,
    active = true,
    workspaces = [],
    dialogPath = null,
    bdStatus,
  } = options;

  await page.addInitScript(
    ({
      projectId: id,
      name: workspaceName,
      issues: tickets,
      syncState: sync,
      theme: pref,
      language: lang,
      active,
      extraWorkspaces,
      picked,
      bd,
    }) => {
      const path = `/repo/${id}`;
      const workspace = {
        path,
        name: workspaceName,
        projectId: id,
        isWorktree: false,
        lastOpenedAt: '2026-11-01T00:00:00Z',
        checkpoint: null,
      };
      const entryFor = (candidate: {
        path: string;
        name: string;
        projectId: string;
        isWorktree?: boolean;
      }) => ({
        path: candidate.path,
        name: candidate.name,
        projectId: candidate.projectId,
        isWorktree: candidate.isWorktree ?? false,
        lastOpenedAt: '2026-11-01T00:00:00Z',
        checkpoint: null,
      });
      const registered = active
        ? [workspace, ...extraWorkspaces.map(entryFor)]
        : extraWorkspaces.map(entryFor);
      // Picking a directory that is already registered switches to it.
      const entryAt = (value: string) => registered.find((item) => item.path === value);
      const snapshot = {
        config: {
          schemaVersion: 1,
          bdPath: null as string | null,
          // The registry is the source of truth for language/theme, so the
          // options have to live here as well as on the e2e seam.
          language: lang ?? 'en',
          theme: pref ?? 'system',
          lastWorkspacePath: null,
          workspaces: registered,
        },
        missing: [],
        active: active ? path : null,
        corruptBackup: null,
      };

      const log: string[] = [];
      // `bd_set_path` replaces what later cached reads resolve to.
      let currentBd = bd;
      (window as unknown as { __invokeLog: string[] }).__invokeLog = log;
      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          // Distinguish a cached read from an actual probe: only `refresh`
          // spawns bd in the real backend.
          log.push(
            command === 'bd_status' && args?.refresh === true ? 'bd_status:refresh' : command
          );
          if (command === 'workspace_snapshot') {
            return snapshot;
          }
          if (command === 'bd_status') {
            return currentBd;
          }
          if (command === 'bd_set_path') {
            const next = args?.path;
            if (typeof next === 'string' && next.trim() !== '') {
              snapshot.config.bdPath = next;
              currentBd = { kind: 'ready', path: next, version: '1.3.2' };
            } else {
              snapshot.config.bdPath = null;
              currentBd = bd;
            }
            return currentBd;
          }
          if (command === 'app_set_preferences') {
            return snapshot.config;
          }
          if (command === 'plugin:app|version') {
            return '0.1.0';
          }
          if (command === 'settings_diagnostics') {
            return {
              bd: { kind: 'ready', path: 'bd', version: '1.3.2' },
              workspace: snapshot.active,
              context:
                snapshot.active === null
                  ? null
                  : {
                      projectId: id,
                      doltMode: 'embedded',
                      schemaVersion: 1,
                    },
              contextError: null,
              calls: [
                {
                  command: 'context',
                  argv: 'context --json',
                  durationMs: 12,
                  exitCode: 0,
                  errorCode: null,
                },
              ],
            };
          }
          if (command === 'plugin:dialog|open') {
            return picked;
          }
          if (command === 'workspace_add') {
            const requested = String(args?.path ?? '');
            const existing = entryAt(requested);
            if (existing !== undefined) {
              snapshot.active = existing.path;
              return existing;
            }
            // Both separators matter: the picker returns a Windows path.
            const cut = Math.max(requested.lastIndexOf('/'), requested.lastIndexOf('\\'));
            const added = {
              path: requested,
              name: cut >= 0 ? requested.slice(cut + 1) : requested,
              projectId: `project-${registered.length + 1}`,
              isWorktree: false,
              lastOpenedAt: new Date().toISOString(),
              checkpoint: null,
            };
            registered.push(added);
            snapshot.active = added.path;
            return added;
          }
          if (command === 'workspace_switch') {
            const target = entryAt(String(args?.path ?? ''));
            if (target === undefined) {
              throw { code: 'WS_INACCESSIBLE', message: 'workspace is not registered' };
            }
            snapshot.active = target.path;
            return target;
          }
          if (command === 'workspace_remove') {
            const target = String(args?.path ?? '');
            const index = registered.findIndex((item) => item.path === target);
            if (index >= 0) {
              registered.splice(index, 1);
            }
            if (snapshot.active === target) {
              snapshot.active = null;
            }
            return true;
          }
          if (command === 'workspace_relocate') {
            const from = String(args?.oldPath ?? '');
            const to = String(args?.newPath ?? '');
            const target = entryAt(from);
            if (target === undefined) {
              throw { code: 'WS_INACCESSIBLE', message: 'workspace is not registered' };
            }
            target.path = to;
            if (snapshot.active === from) {
              snapshot.active = to;
            }
            return target;
          }
          throw new Error(`unexpected command: ${command}`);
        },
      };
      (window as unknown as { __BEADAZZLED_E2E__: unknown }).__BEADAZZLED_E2E__ = {
        issues: tickets,
        syncState: sync,
        theme: pref,
        language: lang,
      };
    },
    {
      projectId,
      name,
      issues,
      syncState,
      theme,
      language,
      active,
      extraWorkspaces: workspaces,
      picked: dialogPath,
      bd: bdStatus ?? { kind: 'ready', path: 'bd', version: '1.3.2' },
    }
  );
}

/** Commands recorded since the page loaded (or since the last reset). */
export function invokeLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __invokeLog: string[] }).__invokeLog);
}

export async function clearInvokeLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __invokeLog: string[] }).__invokeLog.length = 0;
  });
}
