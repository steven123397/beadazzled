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
      const snapshot = {
        config: {
          schemaVersion: 1,
          bdPath: null,
          // The registry is the source of truth for language/theme, so the
          // options have to live here as well as on the e2e seam.
          language: lang ?? 'en',
          theme: pref ?? 'system',
          lastWorkspacePath: null,
          workspaces: active ? [workspace] : [],
        },
        missing: [],
        active: active ? path : null,
        corruptBackup: null,
      };

      const log: string[] = [];
      (window as unknown as { __invokeLog: string[] }).__invokeLog = log;
      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: async (command: string) => {
          log.push(command);
          if (command === 'workspace_snapshot') {
            return snapshot;
          }
          if (command === 'bd_status') {
            return { kind: 'ready', path: 'bd', version: '1.3.2' };
          }
          if (command === 'app_set_preferences') {
            return snapshot.config;
          }
          if (command === 'plugin:app|version') {
            return '0.1.0';
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
    { projectId, name, issues, syncState, theme, language, active }
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
