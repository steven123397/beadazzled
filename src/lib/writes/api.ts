import { invoke } from '@tauri-apps/api/core';

import type { WriteCommand, WriteOutcome as RustWriteOutcome } from '@/bindings/bd';
import { isBridgeError } from '@/lib/errors';
import type { Invoke } from '@/lib/invoke';

import type { WriteOutcome } from './queue';

export type WritesApi = {
  /** Runs one bd write; bd failures come back as outcomes, not rejections. */
  execute(workspace: string, command: WriteCommand): Promise<WriteOutcome>;
};

export function createWritesApi(call: Invoke): WritesApi {
  return {
    async execute(workspace, command) {
      try {
        const outcome = await call<RustWriteOutcome>('execute_write', { workspace, command });
        return { ok: true, createdId: outcome.created_id ?? null };
      } catch (error) {
        if (isBridgeError(error)) {
          return { ok: false, error };
        }
        throw error;
      }
    },
  };
}

export const writesApi = createWritesApi((command, args) => invoke(command, args));