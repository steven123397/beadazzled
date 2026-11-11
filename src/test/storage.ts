export function memoryStorage(entries: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

/** Run a synchronous assertion with a throwing window.localStorage getter. */
export function withThrowingLocalStorage<T>(run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError');
    },
  });

  try {
    return run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(window, 'localStorage');
    } else {
      Object.defineProperty(window, 'localStorage', descriptor);
    }
  }
}
