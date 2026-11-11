import { listen } from '@tauri-apps/api/event';
import { beforeEach, expect, test, vi } from 'vitest';

import type { Invoke } from '@/lib/invoke';

import type { SyncEvent } from './api';
import { createSyncApi, SYNC_EVENTS } from './api';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const listenMock = vi.mocked(listen);

beforeEach(() => {
  listenMock.mockReset();
});

test('start, refresh and stop invoke the Rust sync commands', async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const call: Invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ command, args });
    return undefined as T;
  };
  const api = createSyncApi(call);

  await api.start('/repo/p1');
  await api.refresh('/repo/p1');
  await api.stop();

  expect(calls).toEqual([
    { command: 'sync_start', args: { workspace: '/repo/p1' } },
    { command: 'sync_refresh', args: { workspace: '/repo/p1' } },
    { command: 'sync_stop', args: undefined },
  ]);
});

test.each([
  { event: 'snapshot', wire: 'sync:snapshot', payload: { issues: [], since: 4 } },
  { event: 'records', wire: 'sync:records', payload: [{ seq: 5 }] },
  { event: 'state', wire: 'sync:state', payload: { kind: 'journal-disabled' } },
] as const)(
  'listens to the Rust $wire event and unwraps its payload',
  async ({ event, wire, payload }) => {
    const unlisten = vi.fn();
    const handler = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const result = await createSyncApi().listen<unknown>(event as SyncEvent, handler);

    expect(SYNC_EVENTS[event]).toBe(wire);
    expect(listenMock).toHaveBeenCalledWith(wire, expect.any(Function));
    listenMock.mock.calls[0]?.[1]({ payload } as never);
    expect(handler).toHaveBeenCalledWith(payload);
    expect(result).toBe(unlisten);
  }
);
