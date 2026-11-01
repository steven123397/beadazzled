import { expect, test } from 'vitest';

import type { WriteCommand } from '@/bindings/bd';

import { createWritesApi } from './api';

const COMMAND: WriteCommand = { Reopen: { id: 'bza-1' } };

test('a successful write maps to an ok outcome with the created id', async () => {
  const calls: Array<[string, unknown]> = [];
  const api = createWritesApi(async (command, args) => {
    calls.push([command, args]);
    return { exit_code: 0, created_id: 'bza-new', stderr_excerpt: null } as never;
  });

  const outcome = await api.execute('C:/ws', COMMAND);

  expect(outcome).toEqual({ ok: true, createdId: 'bza-new' });
  expect(calls).toEqual([['execute_write', { workspace: 'C:/ws', command: COMMAND }]]);
});

test('a bridge rejection becomes a failed outcome instead of a throw', async () => {
  const api = createWritesApi(async () => {
    throw { code: 'WRITE_CONFLICT', message: 'precondition failed' };
  });

  await expect(api.execute('C:/ws', COMMAND)).resolves.toEqual({
    ok: false,
    error: { code: 'WRITE_CONFLICT', message: 'precondition failed' },
  });
});

test('a non-bridge rejection is rethrown for the queue to report as internal', async () => {
  const api = createWritesApi(async () => {
    throw new Error('ipc down');
  });

  await expect(api.execute('C:/ws', COMMAND)).rejects.toThrow('ipc down');
});