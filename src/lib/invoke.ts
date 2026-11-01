/** The injected IPC boundary; tests pass a recording fake. */
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;