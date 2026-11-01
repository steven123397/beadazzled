import type { WriteCommand } from '@/bindings/bd';

import { createEchoWaiter, type EchoOutcome } from '../sync/echo';
import type { TicketStore } from '../sync/store';
import { createWriteQueue, type WriteOutcome, type WriteQueue, type WriteResult } from './queue';

/** Everything the write flow needs from sync and the store. */
export type WriteFlow = {
  queue: WriteQueue;
  /** The workspace the UI is editing; the submission carries it to the backend. */
  workspace: () => string;
  /** `sync.lastSeq`, read before the command is dispatched. */
  currentSeq: () => number;
  waitForEcho: (issueId: string, afterSeq: number, timeoutMs?: number) => Promise<EchoOutcome>;
  /** Re-runs the baseline (conflict, echo timeout, disabled journal). */
  refresh: () => void;
};

export type WriteSubmission = {
  /** Dedupe key: issue id + action + normalized payload. */
  key: string;
  /** Defaults to the flow's workspace; pin it to the originating one. */
  workspace?: string;
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
  // Read the sequence when the command is dispatched, not when it is queued:
  // a previous edit's echo can land while this write waits behind it, and that
  // record must not satisfy this write's echo wait. The initial value only
  // covers the deduped path, where `build` is never called.
  let afterSeq = flow.currentSeq();
  const workspace = submission.workspace ?? flow.workspace();
  const result = await flow.queue.submit(submission.key, workspace, () => {
    afterSeq = flow.currentSeq();
    return submission.build();
  });

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

export type WriteFlowOptions = {
  store: TicketStore;
  /** The workspace the UI is editing; each submission carries it to the backend. */
  workspace: () => string;
  /** The IPC call; `writesApi.execute` in the app. */
  execute: (workspace: string, command: WriteCommand) => Promise<WriteOutcome>;
  /** Re-runs the baseline after a conflict, echo timeout or disabled journal. */
  refresh: () => void;
  /** `sync` state: a disabled journal makes the echo wait short-circuit. */
  isJournalDisabled: () => boolean;
};

/** Builds the production flow from the ticket store and the writes API. */
export function createWriteFlow(options: WriteFlowOptions): WriteFlow {
  return {
    queue: createWriteQueue(options.execute),
    workspace: options.workspace,
    currentSeq: () => options.store.getState().lastSeq,
    waitForEcho: createEchoWaiter(options.store, options.isJournalDisabled),
    refresh: options.refresh,
  };
}
