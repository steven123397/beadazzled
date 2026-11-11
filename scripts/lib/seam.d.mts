import type { Page } from '@playwright/test';

export const TAURI_INTERNALS = '__TAURI_INTERNALS__';
export const BEADAZZLED_E2E = '__BEADAZZLED_E2E__';
export const INVOKE_LOG = '__invokeLog';

export const COMMANDS: {
  readonly WORKSPACE_SNAPSHOT: 'workspace_snapshot';
  readonly BD_STATUS: 'bd_status';
  readonly BD_SET_PATH: 'bd_set_path';
  readonly APP_SET_PREFERENCES: 'app_set_preferences';
  readonly PLUGIN_APP_VERSION: 'plugin:app|version';
  readonly SETTINGS_DIAGNOSTICS: 'settings_diagnostics';
  readonly PLUGIN_DIALOG_OPEN: 'plugin:dialog|open';
  readonly WORKSPACE_ADD: 'workspace_add';
  readonly WORKSPACE_SWITCH: 'workspace_switch';
  readonly WORKSPACE_REMOVE: 'workspace_remove';
  readonly WORKSPACE_RELOCATE: 'workspace_relocate';
};

export type WorkspaceSnapshotOptions = {
  projectId?: string;
  name?: string;
  path?: string;
  isWorktree?: boolean;
  lastOpenedAt?: string;
  theme?: string;
  language?: string;
  active?: boolean;
  workspaces?: readonly {
    path: string;
    name: string;
    projectId: string;
    isWorktree?: boolean;
  }[];
  extraWorkspaces?: readonly {
    path: string;
    name: string;
    projectId: string;
    isWorktree?: boolean;
  }[];
};

export function makeWorkspaceSnapshot(options?: WorkspaceSnapshotOptions): {
  config: {
    schemaVersion: number;
    bdPath: string | null;
    language: string;
    theme: string;
    lastWorkspacePath: string | null;
    workspaces: {
      path: string;
      name: string;
      projectId: string;
      isWorktree: boolean;
      lastOpenedAt: string;
      checkpoint: null;
    }[];
  };
  missing: never[];
  active: string | null;
  corruptBackup: null;
};

export type InstallSeamOptions = {
  projectId?: string;
  workspaceName?: string;
  issues?: readonly Record<string, unknown>[];
  syncState?: Record<string, unknown>;
  theme?: 'light' | 'dark' | 'system';
  language?: 'en' | 'zh-CN';
  active?: boolean;
  workspaces?: readonly {
    path: string;
    name: string;
    projectId: string;
    isWorktree?: boolean;
  }[];
  bdStatus?: Record<string, unknown>;
  recordInvokeLog?: boolean;
};

export function installSeam(page: Page, options?: InstallSeamOptions): Promise<void>;

export type IssueFixture = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  created_at: string;
  updated_at: string;
  labels: string[];
  dependency_count: number;
  dependent_count: number;
  comment_count: number;
  [key: string]: unknown;
};

export function makeIssue(
  idOrOverrides?: string | number | Record<string, unknown>,
  overrides?: Record<string, unknown>
): IssueFixture;

export function makeIssues(count: number, map?: (index: number) => IssueFixture): IssueFixture[];
