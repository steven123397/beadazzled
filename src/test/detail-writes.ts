import type { UseWrite } from '@/lib/writes/useWrite';

/** A write controller that succeeds unless a test overrides it. */
export function fakeWrites(overrides: Partial<UseWrite> = {}): UseWrite {
  return {
    pending: [],
    error: null,
    result: null,
    canWrite: true,
    disabledReason: null,
    isPending: () => false,
    submit: async () => ({ status: 'ok' }),
    clearError: () => undefined,
    ...overrides,
  };
}