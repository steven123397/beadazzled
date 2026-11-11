import { vi } from 'vitest';

import type { WorkspaceEntry, WorkspaceSnapshot } from '@/bindings/bd';
import type { UseWorkspace } from '@/lib/workspace/useWorkspace';
import { TEST_TS } from '@/test/fixtures';

export function makeEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  const path = overrides.path ?? '/repo/alpha';
  return {
    path,
    name: path.split('/').pop() ?? path,
    projectId: 'p1',
    isWorktree: false,
    lastOpenedAt: TEST_TS,
    checkpoint: null,
    ...overrides,
  };
}

type SnapshotOverrides = Partial<Omit<WorkspaceSnapshot, 'config'>> & {
  config?: Partial<WorkspaceSnapshot['config']>;
};

export function makeWorkspaceSnapshot(overrides: SnapshotOverrides = {}): WorkspaceSnapshot {
  const { config, ...snapshot } = overrides;
  return {
    config: {
      schemaVersion: 1,
      bdPath: null,
      language: 'en',
      theme: 'system',
      lastWorkspacePath: null,
      workspaces: [],
      ...config,
    },
    missing: [],
    active: null,
    corruptBackup: null,
    ...snapshot,
  };
}

export function makeWorkspace(overrides: Partial<UseWorkspace> = {}): UseWorkspace {
  return {
    snapshot: makeWorkspaceSnapshot(),
    bd: { kind: 'ready', path: 'bd', version: '1.3.2' },
    loading: false,
    error: null,
    reload: vi.fn(),
    refreshBd: vi.fn(),
    add: vi.fn(async () => true),
    switchTo: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    relocate: vi.fn(async () => true),
    setBdPath: vi.fn(async () => null),
    ...overrides,
  };
}
