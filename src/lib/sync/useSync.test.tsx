import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Issue, JournalRecord, SyncState } from '@/bindings/bd';

import type { SyncApi, SyncEvent, SyncSnapshot } from './api';
import { useSync } from './useSync';

function issue(id: string, title = `Issue ${id}`, updatedAt = '2026-11-01T00:00:00Z'): Issue {
  return {
    id,
    title,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: updatedAt,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
  };
}

function record(seq: number, issueValue: Issue): JournalRecord {
  return {
    seq,
    ts: '2026-11-01T00:00:00Z',
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