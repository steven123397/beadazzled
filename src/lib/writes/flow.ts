import type { WriteCommand } from '@/bindings/bd';

import type { WriteQueue, WriteResult } from './queue';

/** What `sync.waitForEcho` reports for one issue. */
export type EchoOutcome = 'echoed' | 'timeout' | 'disabled';

/** Everything the write flow needs from sync and the store. */
export type WriteFlow = {
  queue: WriteQueue;
  /** `sync.lastSeq`, read before the command is dispatched. */
  currentSeq: () => number;
  waitForEcho: (issueId: string, afterSeq: number, timeoutMs?: number) => Promise<EchoOutcome>;
  /** Re-runs the baseline (conflict, echo timeout, disabled journal). */
  refresh: () => void;
};

export type WriteSubmission = {
  /** Dedupe key: issue id + action + normalized payload. */
  key: string;
  issueId: string | null;
  build: () => WriteCommand;
};

const ECHO_TIMEOUT_MS = 3_000;

/**
 * Runs one write and the post-write flow from `SPEC-writes`.
 *
 * The UI only changes when the journal echo arrives; a conflict, an echo
 * timeout or a disabled journal triggers exactly one baseline instead of an
 * optimistic edit or an automatic retry.
 */
export async function submitWrite(
  flow: WriteFlow,
  submission: WriteSubmission
): Promise<WriteResult> {
  const afterSeq = flow.currentSeq();
  const result = await flow.queue.submit(submission.key, submission.build);

  if (result.status === 'conflict') {
    flow.refresh();
    return result;
  }
  if (result.status === 'failed') {
    return result;
  }

  const issueId = result.createdId ?? submission.issueId;
  if (!issueId) {
    return result;
  }

  const echo = await flow.waitForEcho(issueId, afterSeq, ECHO_TIMEOUT_MS);
  if (echo !== 'echoed') {
    flow.refresh();
  }
  return result;
}