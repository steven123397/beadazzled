import { useCallback, useMemo, useState } from 'react';

import type { BdStatus, BridgeError, BridgeErrorCode } from '@/bindings/bd';
import { describeError } from '@/lib/errors';

import { submitWrite, type WriteFlow, type WriteSubmission } from './flow';
import type { WriteResult } from './queue';

const BD_NOT_FOUND: BridgeErrorCode = 'BD_NOT_FOUND';
const BD_VERSION_UNSUPPORTED: BridgeErrorCode = 'BD_VERSION_UNSUPPORTED';

export type UseWrite = {
  /** Issue ids whose write is in flight (including the echo wait). */
  pending: string[];
  error: string | null;
  result: WriteResult | null;
  canWrite: boolean;
  /** Why writes are refused; `null` when bd is ready. */
  disabledReason: string | null;
  isPending: (issueId: string) => boolean;
  submit: (submission: WriteSubmission) => Promise<WriteResult>;
  clearError: () => void;
};

/**
 * The write UI state. While a write is pending the issue's edit controls are
 * disabled; the ticket itself is never changed optimistically. Every failure
 * leaves a visible message and keeps the store untouched.
 */
export function useWrite(flow: WriteFlow, bd: BdStatus | null): UseWrite {
  // One entry per overlapping submission: the id must stay pending until the
  // last one settles, not until the first one does.
  const [inFlight, setInFlight] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult | null>(null);
  const pending = useMemo(() => Array.from(new Set(inFlight)), [inFlight]);

  const canWrite = bd?.kind === 'ready';
  const disabledReason = canWrite ? null : describeError(blockedError(bd)).message;

  const submit = useCallback(
    async (submission: WriteSubmission): Promise<WriteResult> => {
      if (!canWrite) {
        const blocked: WriteResult = { status: 'failed', error: blockedError(bd) };
        setResult(blocked);
        setError(describeError(blocked.error).message);
        return blocked;
      }

      const issueId = submission.issueId;
      if (issueId) {
        setInFlight((previous) => [...previous, issueId]);
      }
      setError(null);

      try {
        const outcome = await submitWrite(flow, submission);
        setResult(outcome);
        if (outcome.status !== 'ok') {
          setError(describeError(outcome.error).message);
        }
        return outcome;
      } finally {
        if (issueId) {
          setInFlight((previous) => {
            const index = previous.indexOf(issueId);
            if (index === -1) {
              return previous;
            }
            return [...previous.slice(0, index), ...previous.slice(index + 1)];
          });
        }
      }
    },
    [flow, canWrite, bd]
  );

  const clearError = useCallback(() => setError(null), []);
  const isPending = useCallback((issueId: string) => pending.includes(issueId), [pending]);

  return {
    pending,
    error,
    result,
    canWrite,
    disabledReason,
    isPending,
    submit,
    clearError,
  };
}

function blockedError(bd: BdStatus | null): BridgeError {
  if (bd?.kind === 'broken') {
    return bd.error;
  }
  if (bd?.kind === 'unsupported') {
    return { code: BD_VERSION_UNSUPPORTED, message: '' };
  }
  return { code: BD_NOT_FOUND, message: '' };
}
