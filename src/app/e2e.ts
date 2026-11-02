import type { Issue, SyncState } from '@/bindings/bd';
import type { Language } from '@/lib/i18n';
import type { Theme } from '@/lib/theme/theme';

export type E2EState = {
  issues?: readonly Issue[];
  syncState?: SyncState;
  language?: Language;
  theme?: Theme;
};

declare global {
  interface Window {
    __BEADAZZLED_E2E__?: E2EState;
  }
}

/**
 * Test-only data injection for `npm run dev:web` + Playwright. The browser
 * has no Tauri IPC and no sync engine yet, so end-to-end specs need a way to
 * provide tickets. `main.tsx` only reads this in dev builds.
 */
export function readE2EState(): E2EState | undefined {
  return window.__BEADAZZLED_E2E__;
}
