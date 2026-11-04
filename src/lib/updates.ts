import type { Update } from '@tauri-apps/plugin-updater';

import { messageOf } from '@/lib/errors';

/**
 * Updater state is process-wide: the startup check runs once, the About
 * section renders whatever it found, and the diagnostics report can quote the
 * last failure. Keeping it outside React avoids a second check when the user
 * opens Settings.
 */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; checkedAt: number }
  | { kind: 'available'; version: string; checkedAt: number }
  | { kind: 'installing'; version: string }
  | { kind: 'installed' }
  | { kind: 'error'; message: string; checkedAt: number };

export type UpdateError = { message: string; at: number };

let state: UpdateState = { kind: 'idle' };
let lastError: UpdateError | null = null;
let pending: Update | null = null;
let inFlight: Promise<UpdateState> | null = null;
const listeners = new Set<() => void>();

function setState(next: UpdateState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getUpdateState(): UpdateState {
  return state;
}

export function getLastUpdateError(): UpdateError | null {
  return lastError;
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test hook: forget the cached result so a case starts from idle. */
export function resetUpdates(): void {
  state = { kind: 'idle' };
  lastError = null;
  pending = null;
  inFlight = null;
}

/**
 * Checks the configured endpoint. A manual check shows every state; the
 * delayed startup check stays quiet on failure (the error is kept for
 * diagnostics) but still surfaces an available update to the About section.
 */
export async function checkForUpdate({ background = false } = {}): Promise<UpdateState> {
  if (inFlight !== null) {
    return inFlight;
  }
  if (!background) {
    setState({ kind: 'checking' });
  }
  inFlight = (async () => {
    try {
      // The updater plugin is only loaded when a check runs, so it stays out of
      // the first-screen bundle and out of the settings chunk until used.
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      const checkedAt = Date.now();
      lastError = null;
      if (update === null) {
        pending = null;
        if (!background) {
          setState({ kind: 'current', checkedAt });
        }
      } else {
        pending = update;
        setState({ kind: 'available', version: update.version, checkedAt });
      }
    } catch (error) {
      const message = messageOf(error);
      const at = Date.now();
      lastError = { message, at };
      // A background failure stays off the first screen, but the About section
      // is where the user looks on purpose; it can show the reason there.
      setState({ kind: 'error', message, checkedAt: at });
    } finally {
      inFlight = null;
    }
    return state;
  })();
  return inFlight;
}

/**
 * Downloads, verifies and installs the update found by the last check, then
 * lets the installer restart the app (passive mode). Errors stay on screen.
 */
export async function installUpdate(): Promise<UpdateState> {
  if (pending === null || state.kind !== 'available') {
    return state;
  }
  const update = pending;
  setState({ kind: 'installing', version: update.version });
  try {
    await update.downloadAndInstall();
    setState({ kind: 'installed' });
  } catch (error) {
    const message = messageOf(error);
    lastError = { message, at: Date.now() };
    setState({ kind: 'error', message, checkedAt: Date.now() });
  }
  return state;
}
