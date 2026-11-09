import type { BridgeError, BridgeErrorCode } from '@/bindings/bd';

const MESSAGES: Partial<Record<BridgeErrorCode, string>> = {
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

/**
 * Best-effort user-facing text for an unknown thrown value: bridge failures
 * get their mapped message, everything else its own message.
 */
export function messageOf(error: unknown): string {
  if (isBridgeError(error)) {
    return describeError(error).message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return String(error);
}

export function internalError(error: unknown): BridgeError {
  return { code: 'INTERNAL', message: messageOf(error) };
}

export function isBridgeError(value: unknown): value is BridgeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as { code: unknown }).code === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

/** Maps a bridge failure to text a person can act on. */
export function describeError(error: BridgeError): {
  code: BridgeErrorCode;
  message: string;
} {
  const base = MESSAGES[error.code];
  if (!base) {
    return { code: error.code, message: error.message };
  }

  // bd reports some failures as JSON on stdout with an empty stderr (for
  // example a directory whose .beads folder has no database), so the bridge
  // puts that text in `bd_error` instead.
  const detailText = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  const stderr =
    error.code === 'BD_EXIT_NONZERO'
      ? detailText(error.detail?.stderr) || detailText(error.detail?.bd_error)
      : '';
  return {
    code: error.code,
    message: stderr ? `${base} ${stderr.slice(0, STDERR_LIMIT)}` : base,
  };
}
