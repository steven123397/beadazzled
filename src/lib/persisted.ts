/** Safe localStorage access; callers own their codecs and fallback (ADR-0017). */
export function readSetting<T>(
  key: string,
  decode: (raw: string) => T,
  fallback: T,
  storage?: Storage
): T {
  try {
    // Property access belongs inside the try: restricted profiles can throw here.
    const store = storage ?? window.localStorage;
    const raw = store.getItem(key);
    return raw === null ? fallback : decode(raw);
  } catch {
    return fallback;
  }
}

export function writeSetting<T>(
  key: string,
  encode: (value: T) => string,
  value: T,
  storage?: Storage
): void {
  try {
    const store = storage ?? window.localStorage;
    store.setItem(key, encode(value));
  } catch {
    // The in-memory operation still succeeds; only persistence is lost.
  }
}
