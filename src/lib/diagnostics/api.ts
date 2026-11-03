import { invoke } from '@tauri-apps/api/core';

import type { DiagnosticsSnapshot } from '@/bindings/bd';
import type { Invoke } from '@/lib/invoke';

export type DiagnosticsApi = {
  /** Runs `settings_diagnostics`: the only settings call that spawns bd. */
  load(): Promise<DiagnosticsSnapshot>;
};

export function createDiagnosticsApi(call: Invoke): DiagnosticsApi {
  return {
    load: () => call<DiagnosticsSnapshot>('settings_diagnostics'),
  };
}

export const diagnosticsApi = createDiagnosticsApi((command, args) => invoke(command, args));
