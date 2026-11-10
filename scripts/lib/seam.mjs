export const TAURI_INTERNALS = '__TAURI_INTERNALS__';
export const BEADAZZLED_E2E = '__BEADAZZLED_E2E__';
export const INVOKE_LOG = '__invokeLog';

export const COMMANDS = {
  WORKSPACE_SNAPSHOT: 'workspace_snapshot',
  BD_STATUS: 'bd_status',
  BD_SET_PATH: 'bd_set_path',
  APP_SET_PREFERENCES: 'app_set_preferences',
  PLUGIN_APP_VERSION: 'plugin:app|version',
  SETTINGS_DIAGNOSTICS: 'settings_diagnostics',
  PLUGIN_DIALOG_OPEN: 'plugin:dialog|open',
  WORKSPACE_ADD: 'workspace_add',
  WORKSPACE_SWITCH: 'workspace_switch',
  WORKSPACE_REMOVE: 'workspace_remove',
  WORKSPACE_RELOCATE: 'workspace_relocate',
};

export function makeWorkspaceSnapshot(options = {}) {
  const projectId = options.projectId ?? 'p1';
  const name = options.name ?? 'alpha';
  const wsPath = options.path ?? `/repo/${projectId}`;
  const isWorktree = options.isWorktree ?? false;
  const lastOpenedAt = options.lastOpenedAt ?? '2026-11-01T00:00:00Z';
  const theme = options.theme ?? 'system';
  const language = options.language ?? 'en';
  const active = options.active ?? true;
  const extraWorkspaces = options.extraWorkspaces ?? options.workspaces ?? [];

  const defaultWs = {
    path: wsPath,
    name,
    projectId,
    isWorktree,
    lastOpenedAt,
    checkpoint: null,
  };

  const entryFor = (candidate) => ({
    path: candidate.path,
    name: candidate.name,
    projectId: candidate.projectId,
    isWorktree: candidate.isWorktree ?? false,
    lastOpenedAt: candidate.lastOpenedAt ?? lastOpenedAt,
    checkpoint: candidate.checkpoint ?? null,
  });

  const registered = active
    ? [defaultWs, ...extraWorkspaces.map(entryFor)]
    : extraWorkspaces.map(entryFor);

  return {
    config: {
      schemaVersion: 1,
      bdPath: null,
      language,
      theme,
      lastWorkspacePath: null,
      workspaces: registered,
    },
    missing: [],
    active: active ? wsPath : null,
    corruptBackup: null,
  };
}

export async function installSeam(page, options = {}) {
  const {
    projectId = 'p1',
    workspaceName = 'alpha',
    issues = [],
    syncState = { kind: 'healthy', lastSeq: 1, lastEventAt: null },
    theme,
    language,
    active = true,
    workspaces = [],
    bdStatus = { kind: 'ready', path: 'bd', version: '1.3.2' },
    recordInvokeLog = true,
  } = options;

  const snapshot = makeWorkspaceSnapshot({
    projectId,
    name: workspaceName,
    theme: theme ?? 'system',
    language: language ?? 'en',
    active,
    workspaces,
  });

  await page.addInitScript(
    ({ snapshot, issues, syncState, theme, language, bdStatus, recordInvokeLog }) => {
      if (recordInvokeLog) {
        window.__invokeLog = [];
      }
      window.__TAURI_INTERNALS__ = {
        invoke: async (command) => {
          if (recordInvokeLog && window.__invokeLog) {
            window.__invokeLog.push(command);
          }
          if (command === 'workspace_snapshot') return snapshot;
          if (command === 'bd_status') return bdStatus;
          throw new Error(`unexpected command: ${command}`);
        },
      };
      const e2ePayload = {
        issues,
      };
      if (syncState !== undefined) {
        e2ePayload.syncState = syncState;
      }
      if (theme !== undefined) {
        e2ePayload.theme = theme;
      }
      if (language !== undefined) {
        e2ePayload.language = language;
      }
      window.__BEADAZZLED_E2E__ = e2ePayload;
    },
    {
      snapshot,
      issues,
      syncState,
      theme,
      language,
      bdStatus,
      recordInvokeLog,
    }
  );
}

export function makeIssue(idOrOverrides = {}, maybeOverrides = {}) {
  const overrides =
    typeof idOrOverrides === 'string'
      ? { id: idOrOverrides, ...maybeOverrides }
      : typeof idOrOverrides === 'number'
        ? { id: `bza-${idOrOverrides}`, title: `Issue ${idOrOverrides}`, ...maybeOverrides }
        : { ...idOrOverrides, ...maybeOverrides };

  const id = overrides.id ?? 'bza-1';
  return {
    id,
    title: overrides.title ?? `Issue ${id}`,
    description: overrides.description ?? '',
    status: overrides.status ?? 'open',
    priority: overrides.priority ?? 2,
    issue_type: overrides.issue_type ?? 'task',
    created_at: overrides.created_at ?? '2026-11-01T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-11-01T00:00:00Z',
    labels: overrides.labels ?? [],
    dependency_count: overrides.dependency_count ?? 0,
    dependent_count: overrides.dependent_count ?? 0,
    comment_count: overrides.comment_count ?? 0,
    ...overrides,
  };
}

export function makeIssues(count, map) {
  return Array.from({ length: count }, (_, index) =>
    map ? map(index) : makeIssue(index)
  );
}
