import { vi } from 'vitest';

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
    submit: vi.fn(async () => ({ status: 'ok' as const })),
    clearError: vi.fn(),
    ...overrides,
  };
}

/** A successful write controller whose journal echo has already arrived. */
export function fakeEchoWrites(overrides: Partial<UseWrite> = {}): UseWrite {
  return fakeWrites({
    submit: vi.fn(async () => ({ status: 'ok' as const, echo: 'echoed' as const })),
    ...overrides,
  });
}
