import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Issue, JournalRecord, SyncState } from '@/bindings/bd';
import { makeIssue, TEST_TS } from '@/test/fixtures';

import type { SyncApi, SyncEvent, SyncSnapshot } from './api';
import { useSync } from './useSync';

function issue(id: string, title = `Issue ${id}`, updatedAt = TEST_TS): Issue {
  return makeIssue(id, { title, updated_at: updatedAt });
}

function record(seq: number, issueValue: Issue): JournalRecord {
  return {
    seq,
    ts: TEST_TS,
    op: 'update',
    issue_id: issueValue.id,
    issue: issueValue,
  };
}

function fakeApi() {
  const handlers = new Map<SyncEvent, (payload: unknown) => void>();
  const start = vi.fn(async () => undefined);
  const refresh = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const api: SyncApi = {
    start,
    refresh,
    stop,
    listen: async <T,>(event: SyncEvent, handler: (payload: T) => void) => {
      handlers.set(event, handler as (payload: unknown) => void);
      return () => {
        handlers.delete(event);
      };
    },
  };
  const emit = (event: SyncEvent, payload: unknown) => {
    handlers.get(event)?.(payload);
  };
  return { api, emit, start, refresh, stop };
}

test('subscribes before starting and applies snapshot, records and state', async () => {
  const fake = fakeApi();
  const { result } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );

  await waitFor(() => expect(fake.start).toHaveBeenCalledWith('/repo/p1'));

  act(() => {
    fake.emit('snapshot', { issues: [issue('bza-1')], since: 5 } satisfies SyncSnapshot);
  });
  expect(result.current.issues.map((item) => item.id)).toEqual(['bza-1']);

  act(() => {
    fake.emit('records', [record(6, issue('bza-1', 'Updated'))]);
  });
  expect(result.current.issues[0]?.title).toBe('Updated');

  const healthy: SyncState = { kind: 'healthy', lastSeq: 6, lastEventAt: null };
  act(() => {
    fake.emit('state', healthy);
  });
  expect(result.current.state).toEqual(healthy);
});

test('a sequence gap asks the backend for a fresh baseline', async () => {
  const fake = fakeApi();
  const { result } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );
  await waitFor(() => expect(fake.start).toHaveBeenCalled());

  act(() => {
    fake.emit('snapshot', { issues: [issue('bza-1')], since: 5 } satisfies SyncSnapshot);
  });
  act(() => {
    fake.emit('records', [record(7, issue('bza-1'))]);
  });

  await waitFor(() => expect(fake.refresh).toHaveBeenCalledWith('/repo/p1'));
  expect(result.current.issues).toHaveLength(1);
});

test('stops the worker on unmount and when the workspace disappears', async () => {
  const fake = fakeApi();
  const { result, rerender, unmount } = renderHook(
    ({ workspace }: { workspace: string | null }) =>
      useSync({ workspace, ready: true, api: fake.api }),
    { initialProps: { workspace: '/repo/p1' as string | null } }
  );
  await waitFor(() => expect(fake.start).toHaveBeenCalled());

  rerender({ workspace: null });
  await waitFor(() => expect(fake.stop).toHaveBeenCalled());
  expect(result.current.issues).toEqual([]);

  unmount();
  expect(fake.stop).toHaveBeenCalled();
});

test('a failed start surfaces bd-unavailable instead of staying loading', async () => {
  const fake = fakeApi();
  fake.start.mockRejectedValue({ code: 'BD_NOT_FOUND', message: 'bd was not found' });

  const { result } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );

  await waitFor(() => expect(result.current.state.kind).toBe('bd-unavailable'));
  expect(result.current.state).toEqual({
    kind: 'bd-unavailable',
    error: { code: 'BD_NOT_FOUND', message: 'bd was not found' },
  });
});

test('refresh asks the backend for a new baseline', async () => {
  const fake = fakeApi();
  const { result } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );
  await waitFor(() => expect(fake.start).toHaveBeenCalled());

  act(() => result.current.refresh());

  expect(fake.refresh).toHaveBeenCalledWith('/repo/p1');
});

test('disabled sync never touches the Tauri API', () => {
  const fake = fakeApi();
  renderHook(() => useSync({ workspace: '/repo/p1', ready: true, enabled: false, api: fake.api }));

  expect(fake.start).not.toHaveBeenCalled();
  expect(fake.stop).not.toHaveBeenCalled();
});
test('a refresh rejection from a previous workspace does not replace the state', async () => {
  const fake = fakeApi();
  let fail: ((error: unknown) => void) | null = null;
  fake.refresh.mockImplementation(
    () =>
      new Promise<undefined>((_resolve, reject) => {
        fail = reject;
      })
  );

  const { result, rerender } = renderHook(
    ({ workspace }: { workspace: string }) => useSync({ workspace, ready: true, api: fake.api }),
    { initialProps: { workspace: '/repo/p1' } }
  );
  await waitFor(() => expect(fake.start).toHaveBeenCalled());

  act(() => result.current.refresh());
  rerender({ workspace: '/repo/p2' });
  act(() => fail?.({ code: 'BD_TIMEOUT', message: 'slow' }));

  await waitFor(() => expect(result.current.state.kind).toBe('loading'));
  expect(result.current.state.kind).not.toBe('bd-unavailable');
});

test('unmounting during listener setup unsubscribes without starting', async () => {
  const fake = fakeApi();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const unlisteners: Array<ReturnType<typeof vi.fn>> = [];
  const listen = vi.spyOn(fake.api, 'listen').mockImplementation(async () => {
    await gate;
    const unlisten = vi.fn();
    unlisteners.push(unlisten);
    return unlisten;
  });

  const { unmount } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );
  await waitFor(() => expect(listen).toHaveBeenCalledTimes(3));

  unmount();
  act(() => release());

  await waitFor(() => {
    expect(unlisteners).toHaveLength(3);
    for (const unlisten of unlisteners) {
      expect(unlisten).toHaveBeenCalledTimes(1);
    }
  });
  expect(fake.start).not.toHaveBeenCalled();
});

test('a listener registration failure becomes an internal unavailable state', async () => {
  const fake = fakeApi();
  vi.spyOn(fake.api, 'listen').mockRejectedValueOnce(new Error('listen failed'));

  const { result } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );

  await waitFor(() =>
    expect(result.current.state).toEqual({
      kind: 'bd-unavailable',
      error: { code: 'INTERNAL', message: 'listen failed' },
    })
  );
  expect(fake.start).not.toHaveBeenCalled();
});

test.each([
  { name: 'sync is disabled', workspace: '/repo/p1', ready: true, enabled: false },
  { name: 'the workspace is missing', workspace: null, ready: true, enabled: true },
  { name: 'bd is not ready', workspace: '/repo/p1', ready: false, enabled: true },
])('refresh is a no-op when $name', ({ workspace, ready, enabled }) => {
  const fake = fakeApi();
  const { result } = renderHook(() => useSync({ workspace, ready, enabled, api: fake.api }));

  act(() => result.current.refresh());

  expect(fake.refresh).not.toHaveBeenCalled();
});

test('a current-workspace refresh rejection preserves the bridge detail', async () => {
  const fake = fakeApi();
  fake.refresh.mockRejectedValue({
    code: 'BD_TIMEOUT',
    message: 'slow',
    detail: { operation: 'refresh' },
  });
  const { result } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );
  await waitFor(() => expect(fake.start).toHaveBeenCalled());

  act(() => result.current.refresh());

  await waitFor(() =>
    expect(result.current.state).toEqual({
      kind: 'bd-unavailable',
      error: {
        code: 'BD_TIMEOUT',
        message: 'slow',
        detail: { operation: 'refresh' },
      },
    })
  );
});

test('a failed baseline after a sequence gap becomes visible', async () => {
  const fake = fakeApi();
  fake.refresh.mockRejectedValue(new Error('baseline failed'));
  const { result } = renderHook(() =>
    useSync({ workspace: '/repo/p1', ready: true, api: fake.api })
  );
  await waitFor(() => expect(fake.start).toHaveBeenCalled());

  act(() => {
    fake.emit('snapshot', { issues: [issue('bza-1')], since: 5 } satisfies SyncSnapshot);
  });
  act(() => {
    fake.emit('records', [record(7, issue('bza-1'))]);
  });

  await waitFor(() =>
    expect(result.current.state).toEqual({
      kind: 'bd-unavailable',
      error: { code: 'INTERNAL', message: 'baseline failed' },
    })
  );
});

test('stop failures are swallowed during workspace teardown', async () => {
  const fake = fakeApi();
  const { result, rerender } = renderHook(
    ({ workspace }: { workspace: string | null }) =>
      useSync({ workspace, ready: true, api: fake.api }),
    { initialProps: { workspace: '/repo/p1' as string | null } }
  );
  await waitFor(() => expect(fake.start).toHaveBeenCalled());
  fake.stop.mockRejectedValue(new Error('stop failed'));

  rerender({ workspace: null });

  await waitFor(() => expect(fake.stop).toHaveBeenCalledTimes(2));
  expect(result.current.state).toEqual({ kind: 'loading', step: 'export' });
});
