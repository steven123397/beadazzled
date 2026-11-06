import type { Page } from '@playwright/test';
import {
  COMMANDS,
  INVOKE_LOG,
  TAURI_INTERNALS,
  BEADAZZLED_E2E,
  makeWorkspaceSnapshot,
} from '../../scripts/lib/seam.mjs';

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

  const snapshot = makeWorkspaceSnapshot({
    projectId,
    name,
    theme: theme ?? 'system',
    language: language ?? 'en',
    active,
    extraWorkspaces: workspaces,
  });

  await page.addInitScript(
    ({
      id,
      snapshot,
      issues: tickets,
      syncState: sync,
      theme: pref,
      language: lang,
      picked,
      bd,
      INVOKE_LOG: logKey,
      TAURI_INTERNALS: tauriKey,
      BEADAZZLED_E2E: e2eKey,
      COMMANDS: cmds,
    }) => {
      const registered = snapshot.config.workspaces;
      // Picking a directory that is already registered switches to it.
      const entryAt = (value: string) => registered.find((item) => item.path === value);

      const log: string[] = [];
      // `bd_set_path` replaces what later cached reads resolve to.
      let currentBd = bd;
      (window as unknown as Record<string, unknown>)[logKey] = log;
      (window as unknown as Record<string, unknown>)[tauriKey] = {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          // Distinguish a cached read from an actual probe: only `refresh`
          // spawns bd in the real backend.
          log.push(
            command === cmds.BD_STATUS && args?.refresh === true ? 'bd_status:refresh' : command
          );
          if (command === cmds.WORKSPACE_SNAPSHOT) {
            return snapshot;
          }
          if (command === cmds.BD_STATUS) {
            return currentBd;
          }
          if (command === cmds.BD_SET_PATH) {
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
          if (command === cmds.APP_SET_PREFERENCES) {
            return snapshot.config;
          }
          if (command === cmds.PLUGIN_APP_VERSION) {
            return '0.1.0';
          }
          if (command === cmds.SETTINGS_DIAGNOSTICS) {
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
          if (command === cmds.PLUGIN_DIALOG_OPEN) {
            return picked;
          }
          if (command === cmds.WORKSPACE_ADD) {
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
          if (command === cmds.WORKSPACE_SWITCH) {
            const target = entryAt(String(args?.path ?? ''));
            if (target === undefined) {
              throw { code: 'WS_INACCESSIBLE', message: 'workspace is not registered' };
            }
            snapshot.active = target.path;
            return target;
          }
          if (command === cmds.WORKSPACE_REMOVE) {
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
          if (command === cmds.WORKSPACE_RELOCATE) {
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
      (window as unknown as Record<string, unknown>)[e2eKey] = {
        issues: tickets,
        syncState: sync,
        theme: pref,
        language: lang,
      };
    },
    {
      id: projectId,
      snapshot,
      issues,
      syncState,
      theme,
      language,
      picked: dialogPath,
      bd: bdStatus ?? { kind: 'ready', path: 'bd', version: '1.3.2' },
      INVOKE_LOG,
      TAURI_INTERNALS,
      BEADAZZLED_E2E,
      COMMANDS,
    }
  );
}

/** Commands recorded since the page loaded (or since the last reset). */
export function invokeLog(page: Page): Promise<string[]> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, string[]>)[key],
    INVOKE_LOG
  );
}

export async function clearInvokeLog(page: Page): Promise<void> {
  await page.evaluate((key) => {
    (window as unknown as Record<string, string[]>)[key].length = 0;
  }, INVOKE_LOG);
}
