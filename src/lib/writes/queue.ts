import type { BridgeError, WriteCommand } from '@/bindings/bd';

import type { EchoOutcome } from '../sync/echo';

/** What the IPC layer reports for one `bd` write. */
export type WriteOutcome =
  { ok: true; createdId: string | null } | { ok: false; error: BridgeError };

export type WriteResult =
  | { status: 'ok'; createdId?: string; echo?: EchoOutcome; afterSeq?: number }
  | { status: 'conflict'; error: BridgeError }
  | { status: 'failed'; error: BridgeError };

export type WriteExecutor = (workspace: string, command: WriteCommand) => Promise<WriteOutcome>;

export interface WriteQueue {
  /**
   * Enqueues one write for `workspace`. Identical keys submitted for the same
   * workspace before dispatch share one promise and produce one bd call; the
   * shared result also carries the `afterSeq` read when that one write was
   * dispatched, so a deduplicated caller never waits on a stale position.
   */
  submit(
    key: string,
    workspace: string,
    build: () => WriteCommand,
    afterSeq?: () => number
  ): Promise<WriteResult>;
  /** Writes still waiting behind the in-flight one. */
  pendingCount(): number;
}

type Task = {
  dedupeKey: string;
  workspace: string;
  build: () => WriteCommand;
  afterSeq?: () => number;
  resolve: (result: WriteResult) => void;
};

/**
 * A per-workspace FIFO queue: one write in flight, no retries, every failure
 * reported as a result instead of a rejection.
 */
export function createWriteQueue(execute: WriteExecutor): WriteQueue {
  const waiting: Task[] = [];
  const undispatched = new Map<string, Promise<WriteResult>>();
  let running = false;
  let scheduled = false;

  function schedulePump(): void {
    if (scheduled || running) {
      return;
    }
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void pump();
    });
  }

  async function pump(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    try {
      while (waiting.length > 0) {
        const task = waiting.shift()!;
        undispatched.delete(task.dedupeKey);
        task.resolve(await run(task));
      }
    } finally {
      running = false;
    }
  }

  async function run(task: Task): Promise<WriteResult> {
    let outcome: WriteOutcome;
    // Read at dispatch, immediately before the command is built and sent: an
    // earlier echo must not be mistaken for this write's own.
    const afterSeq = task.afterSeq?.();
    try {
      outcome = await execute(task.workspace, task.build());
    } catch (error) {
      return { status: 'failed', error: internalError(error) };
    }
    if (outcome.ok) {
      const created =
        outcome.createdId === null || outcome.createdId === undefined
          ? {}
          : { createdId: outcome.createdId };
      return { status: 'ok', ...created, ...(afterSeq === undefined ? {} : { afterSeq }) };
    }
    return outcome.error.code === 'WRITE_CONFLICT'
      ? { status: 'conflict', error: outcome.error }
      : { status: 'failed', error: outcome.error };
  }

  return {
    submit(key, workspace, build, afterSeq) {
      // The workspace is part of the identity: the same issue key can exist in
      // two workspaces, and those writes must not be deduplicated together.
      const dedupeKey = `${workspace}\u0000${key}`;
      const existing = undispatched.get(dedupeKey);
      if (existing) {
        return existing;
      }
      let resolve!: (result: WriteResult) => void;
      const promise = new Promise<WriteResult>((settle) => {
        resolve = settle;
      });
      const task: Task = { dedupeKey, workspace, build, afterSeq, resolve };
      waiting.push(task);
      undispatched.set(dedupeKey, promise);
      schedulePump();
      return promise;
    },
    pendingCount() {
      return waiting.length;
    },
  };
}

function internalError(error: unknown): BridgeError {
  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : String(error),
  };
}
