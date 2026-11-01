import { invoke } from '@tauri-apps/api/core';

import type { BdStatus, Checkpoint, WorkspaceEntry, WorkspaceSnapshot } from '@/bindings/bd';

/** The injected IPC boundary; tests pass a recording fake. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type WorkspaceApi = {
  snapshot(): Promise<WorkspaceSnapshot>;
  bdStatus(refresh?: boolean): Promise<BdStatus>;
  setBdPath(path: string | null): Promise<BdStatus>;
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
    add: (path) => call<WorkspaceEntry>('workspace_add', { path }),
    switchTo: (path) => call<WorkspaceEntry>('workspace_switch', { path }),
    remove: (path) => call<boolean>('workspace_remove', { path }),
    relocate: (oldPath, newPath) =>
      call<WorkspaceEntry>('workspace_relocate', { oldPath, newPath }),
    setCheckpoint: (path, seq) =>
      call<boolean>('workspace_set_checkpoint', { path, seq }),
    checkpoint: (path, projectId) =>
      call<Checkpoint | null>('workspace_checkpoint', { path, projectId }),
    flush: () => call<void>('workspace_flush'),
  };
}

export const workspaceApi = createWorkspaceApi((command, args) => invoke(command, args));