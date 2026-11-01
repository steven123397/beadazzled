import type { BridgeError } from '@/bindings/bd';

const MESSAGES: Partial<Record<BridgeError['code'], string>> = {
  WRITE_CONFLICT: 'This issue changed elsewhere; refreshing the view.',
  BD_TIMEOUT: 'Saving timed out: bd did not respond within 20 seconds.',
  BD_LOCKED: 'The beads database is busy; try again in a moment.',
  BD_EXIT_NONZERO: 'bd rejected the change.',
  BD_NOT_FOUND: 'bd was not found. Set its path in Settings or install it with winget.',
  BD_NOT_EXECUTABLE: 'The configured bd path is not executable.',
  BD_VERSION_UNSUPPORTED: 'This bd version is older than 1.3.2; update bd and try again.',
  WS_NOT_BEADS: 'This directory is not a beads workspace.',
  WS_INACCESSIBLE: 'This workspace cannot be read.',
  JOURNAL_DISABLED: 'Real-time updates are off; the view was refreshed after saving.',
};

const STDERR_LIMIT = 300;

/** Maps a bridge failure to text a person can act on. */
export function describeError(error: BridgeError): {
  code: BridgeError['code'];
  message: string;
} {
  const base = MESSAGES[error.code];
  if (!base) {
    return { code: error.code, message: error.message };
  }

  const stderr =
    error.code === 'BD_EXIT_NONZERO' && typeof error.detail?.stderr === 'string'
      ? error.detail.stderr.trim()
      : '';
  return {
    code: error.code,
    message: stderr ? `${base} ${stderr.slice(0, STDERR_LIMIT)}` : base,
  };
}