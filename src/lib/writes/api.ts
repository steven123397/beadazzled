import { invoke } from '@tauri-apps/api/core';

import type { BridgeError, WriteCommand, WriteOutcome as RustWriteOutcome } from '@/bindings/bd';
import type { Invoke } from '@/lib/invoke';

import type { WriteOutcome } from './queue';

export type WritesApi = {
  /** Runs one bd write; bd failures come back as outcomes, not rejections. */
  execute(command: WriteCommand): Promise<WriteOutcome>;
};

export function createWritesApi(call: Invoke): WritesApi {
  return {
    async execute(command) {
      try {
        const outcome = await call<RustWriteOutcome>('execute_write', { command });
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

function isBridgeError(value: unknown): value is BridgeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

export const writesApi = createWritesApi((command, args) => invoke(command, args));