import type { TicketStore } from './store';

export type EchoOutcome = 'echoed' | 'timeout' | 'disabled';

export const ECHO_TIMEOUT_MS = 3_000;

export type EchoWaiter = (
  issueId: string,
  afterSeq: number,
  timeoutMs?: number
) => Promise<EchoOutcome>;

/**
 * The write path does not update the store optimistically; it waits until a
 * journal record for the issue lands past `afterSeq`. A disabled journal is
 * reported immediately so the caller can refresh instead of waiting 3s.
 */
export function createEchoWaiter(store: TicketStore, isJournalDisabled: () => boolean): EchoWaiter {
  return (issueId, afterSeq, timeoutMs = ECHO_TIMEOUT_MS) =>
    new Promise<EchoOutcome>((resolve) => {
      let settled = false;
      let unsubscribe = () => {};
      const finish = (outcome: EchoOutcome) => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        clearTimeout(timer);
        resolve(outcome);
      };
      const check = () => {
        if (isJournalDisabled()) {
          finish('disabled');
          return;
        }
        if ((store.getState().issueSeq[issueId] ?? 0) > afterSeq) {
          finish('echoed');
        }
      };

      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      unsubscribe = store.subscribe(check);
      check();
    });
}
