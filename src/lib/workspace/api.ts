import { invoke } from '@tauri-apps/api/core';

import type {
  AppConfig,
  BdStatus,
  Checkpoint,
  WorkspaceEntry,
  WorkspaceSnapshot,
} from '@/bindings/bd';
import type { Language } from '@/lib/i18n';
import type { Theme } from '@/lib/theme/theme';
import type { Invoke } from '@/lib/invoke';

export type { Invoke } from '@/lib/invoke';

export type WorkspaceApi = {
  snapshot(): Promise<WorkspaceSnapshot>;
  bdStatus(refresh?: boolean): Promise<BdStatus>;
  setBdPath(path: string | null): Promise<BdStatus>;
  setPreferences(language: Language, theme: Theme): Promise<AppConfig>;
  add(path: string): Promise<WorkspaceEntry>;
  switchTo(path: string): Promise<WorkspaceEntry>;
  remove(path: string): Promise<boolean>;
  relocate(oldPath: string, newPath: string): Promise<WorkspaceEntry>;
  setCheckpoint(path: string, seq: number): Promise<boolean>;
  checkpoint(path: string, projectId: string): Promise<Checkpoint | null>;
  flush(): Promise<void>;
};

/** Wraps the Tauri commands exposed by `src-tauri/src/commands/workspace.rs`. */
export function createWorkspaceApi(call: Invoke): WorkspaceApi {
  return {
    snapshot: () => call<WorkspaceSnapshot>('workspace_snapshot'),
    bdStatus: (refresh = false) => call<BdStatus>('bd_status', { refresh }),
    setBdPath: (path) => call<BdStatus>('bd_set_path', { path }),
    setPreferences: (language, theme) =>
      call<AppConfig>('app_set_preferences', { language, theme }),
    add: (path) => call<WorkspaceEntry>('workspace_add', { path }),
    switchTo: (path) => call<WorkspaceEntry>('workspace_switch', { path }),
    remove: (path) => call<boolean>('workspace_remove', { path }),
    relocate: (oldPath, newPath) =>
      call<WorkspaceEntry>('workspace_relocate', { oldPath, newPath }),
    setCheckpoint: (path, seq) => call<boolean>('workspace_set_checkpoint', { path, seq }),
    checkpoint: (path, projectId) =>
      call<Checkpoint | null>('workspace_checkpoint', { path, projectId }),
    flush: () => call<void>('workspace_flush'),
  };
}

export const workspaceApi = createWorkspaceApi((command, args) => invoke(command, args));
