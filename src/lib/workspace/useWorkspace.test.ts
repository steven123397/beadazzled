import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';

import type { BdStatus, WorkspaceEntry, WorkspaceSnapshot } from '@/bindings/bd';

import type { WorkspaceApi } from './api';
import { useWorkspace } from './useWorkspace';

const TS = '2026-11-01T00:00:00Z';
const READY: BdStatus = { kind: 'ready', path: 'C:/tools/bd.exe', version: '1.3.2' };

function entry(path: string): WorkspaceEntry {
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? path,
    projectId: 'project-1',
    isWorktree: false,
    lastOpenedAt: TS,
    checkpoint: null,
  };
}

function snapshot(active: string | null): WorkspaceSnapshot {
  return {
    config: {
      schemaVersion: 1,
      bdPath: null,
      language: 'en',
      theme: 'system',
      lastWorkspacePath: active,
      workspaces: active ? [entry(active)] : [],
    },
    missing: [],
    active,
    corruptBackup: null,
  };
}

function fakeApi(): { api: WorkspaceApi; calls: string[]; setFound: (bd: BdStatus) => void } {
  const calls: string[] = [];
  let active: string | null = null;
  let found: BdStatus = READY;

  const api: WorkspaceApi = {
    snapshot: async () => {
      calls.push('snapshot');
      return snapshot(active);
    },
    bdStatus: async (refresh = false) => {
      calls.push(`bd:${refresh}`);
      return found;
    },
    setBdPath: async (path) => {
      calls.push(`setBdPath:${String(path)}`);
      return found;
    },
    add: async (path) => {
      calls.push(`add:${path}`);
      active = path;
      return entry(path);
    },
    switchTo: async (path) => {
      calls.push(`switch:${path}`);
      active = path;
      return entry(path);
    },
    remove: async (path) => {
      calls.push(`remove:${path}`);
      if (active === path) {
        active = null;
      }
      return true;
    },
    relocate: async (oldPath, newPath) => {
      calls.push(`relocate:${oldPath}->${newPath}`);
      if (active === oldPath) {
        active = newPath;
      }
      return entry(newPath);
    },
    setCheckpoint: async () => true,
    checkpoint: async () => null,
    flush: async () => {},
  };

  return {
    api,
    calls,
    setFound: (bd) => {
      found = bd;
    },
  };
}

test('an older reload cannot overwrite a newer one', async () => {
  const pending: Array<(value: WorkspaceSnapshot) => void> = [];
  const api: WorkspaceApi = {
    snapshot: () => new Promise((resolve) => pending.push(resolve)),
    bdStatus: async () => READY,
    setBdPath: async () => READY,
    add: async (path) => entry(path),
    switchTo: async (path) => entry(path),
    remove: async () => true,
    relocate: async (_oldPath, path) => entry(path),
    setCheckpoint: async () => true,
    checkpoint: async () => null,
    flush: async () => {},
  };
  const { result } = renderHook(() => useWorkspace(api));

  await act(async () => {
    void result.current.reload();
  });
  expect(pending).toHaveLength(2);

  await act(async () => {
    pending[1](snapshot('new'));
  });
  await act(async () => {
    pending[0](snapshot('old'));
  });

  expect(result.current.snapshot?.active).toBe('new');
});

test('loads the snapshot and bd status on mount', async () => {
  const { api } = fakeApi();

  const { result } = renderHook(() => useWorkspace(api));

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.snapshot).toEqual(snapshot(null));
  expect(result.current.bd).toEqual(READY);
  expect(result.current.error).toBeNull();
});

test('adding a workspace opens it and reloads the snapshot', async () => {
  const { api, calls } = fakeApi();
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    expect(await result.current.add('D:/repo')).toBe(true);
  });

  expect(calls).toContain('add:D:/repo');
  expect(result.current.snapshot?.active).toBe('D:/repo');
  expect(calls.filter((call) => call === 'snapshot')).toHaveLength(2);
});

test('a failing add keeps the previous snapshot and shows the reason', async () => {
  const { api } = fakeApi();
  api.add = async () => {
    throw { code: 'WS_NOT_BEADS', message: 'raw rejection' };
  };
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const before = result.current.snapshot;

  await act(async () => {
    expect(await result.current.add('D:/plain')).toBe(false);
  });

  expect(result.current.snapshot).toBe(before);
  expect(result.current.error).toMatch(/not a beads workspace/i);
});

test('switching updates the active workspace', async () => {
  const { api } = fakeApi();
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    expect(await result.current.switchTo('D:/other')).toBe(true);
  });

  expect(result.current.snapshot?.active).toBe('D:/other');
});

test('removing the active workspace clears it', async () => {
  const { api } = fakeApi();
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.add('D:/repo');
  });

  await act(async () => {
    expect(await result.current.remove('D:/repo')).toBe(true);
  });

  expect(result.current.snapshot?.active).toBeNull();
});

test('refreshBd asks the backend for a fresh probe', async () => {
  const { api, calls, setFound } = fakeApi();
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));
  setFound({ kind: 'not-found', searched: ['C:/tools/bd.exe'] });

  await act(async () => {
    await result.current.refreshBd();
  });

  expect(calls).toContain('bd:true');
  expect(result.current.bd).toEqual({ kind: 'not-found', searched: ['C:/tools/bd.exe'] });
});

test('a failing bd refresh keeps the previous status', async () => {
  const { api } = fakeApi();
  let failRefresh = false;
  api.bdStatus = async (refresh = false) => {
    if (refresh && failRefresh) {
      throw { code: 'INTERNAL', message: 'probe failed' };
    }
    return READY;
  };
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));
  failRefresh = true;

  await act(async () => {
    await result.current.refreshBd();
  });

  expect(result.current.bd).toEqual(READY);
  expect(result.current.error).toBe('probe failed');
});
test('relocating the active workspace follows the new path', async () => {
  const { api } = fakeApi();
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.add('D:/old');
  });

  await act(async () => {
    expect(await result.current.relocate('D:/old', 'D:/new')).toBe(true);
  });

  expect(result.current.snapshot?.active).toBe('D:/new');
});

test('saving an explicit bd path reloads the status', async () => {
  const { api, calls } = fakeApi();
  const { result } = renderHook(() => useWorkspace(api));
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    expect(await result.current.setBdPath('C:/tools/bd.exe')).toBe(true);
  });

  expect(calls).toContain('setBdPath:C:/tools/bd.exe');
  expect(result.current.bd).toEqual(READY);
});

test('an initial load failure is visible instead of an empty workspace list', async () => {
  const { api } = fakeApi();
  api.snapshot = async () => {
    throw { code: 'INTERNAL', message: 'registry unreadable' };
  };

  const { result } = renderHook(() => useWorkspace(api));

  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.snapshot).toBeNull();
  expect(result.current.error).toBe('registry unreadable');
});
