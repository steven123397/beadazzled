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
  const workspace = submission.workspace ?? flow.workspace();
  // The queue reads the sequence when it dispatches the write and hands the
  // same value back to every caller sharing that dispatch. A deduplicated
  // caller never runs `build`, so it cannot read the position itself: an edit
  // queued behind another write must not accept the earlier echo as its own.
  const result = await flow.queue.submit(
    submission.key,
    workspace,
    () => submission.build(),
    () => flow.currentSeq()
  );

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

  // A queue that cannot report the dispatch position leaves the wait unscoped,
  // which would accept any echo; treat that as an unconfirmed write instead.
  if (result.afterSeq === undefined) {
    flow.refresh();
    return { ...result, echo: 'timeout' };
  }

  const echo = await flow.waitForEcho(issueId, result.afterSeq, ECHO_TIMEOUT_MS);
  if (echo !== 'echoed') {
    flow.refresh();
  }
  return { ...result, echo };
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
