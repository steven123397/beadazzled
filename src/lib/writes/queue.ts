import type { BridgeError, WriteCommand } from '@/bindings/bd';

/** What the IPC layer reports for one `bd` write. */
export type WriteOutcome =
  | { ok: true; createdId: string | null }
  | { ok: false; error: BridgeError };

export type WriteResult =
  | { status: 'ok'; createdId?: string }
  | { status: 'conflict'; error: BridgeError }
  | { status: 'failed'; error: BridgeError };

export type WriteExecutor = (command: WriteCommand) => Promise<WriteOutcome>;

export interface WriteQueue {
  /**
   * Enqueues one write. Identical `key`s submitted before dispatch share one
   * promise and produce one bd call.
   */
  submit(key: string, build: () => WriteCommand): Promise<WriteResult>;
  /** Writes still waiting behind the in-flight one. */
  pendingCount(): number;
}

type Task = {
  key: string;
  build: () => WriteCommand;
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
        undispatched.delete(task.key);
        task.resolve(await run(task));
      }
    } finally {
      running = false;
    }
  }

  async function run(task: Task): Promise<WriteResult> {
    let outcome: WriteOutcome;
    try {
      outcome = await execute(task.build());
    } catch (error) {
      return { status: 'failed', error: internalError(error) };
    }
    if (outcome.ok) {
      return outcome.createdId === null || outcome.createdId === undefined
        ? { status: 'ok' }
        : { status: 'ok', createdId: outcome.createdId };
    }
    return outcome.error.code === 'WRITE_CONFLICT'
      ? { status: 'conflict', error: outcome.error }
      : { status: 'failed', error: outcome.error };
  }

  return {
    submit(key, build) {
      const existing = undispatched.get(key);
      if (existing) {
        return existing;
      }
      let resolve!: (result: WriteResult) => void;
      const promise = new Promise<WriteResult>((settle) => {
        resolve = settle;
      });
      const task: Task = { key, build, resolve };
      waiting.push(task);
      undispatched.set(key, promise);
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