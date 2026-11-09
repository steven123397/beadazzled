/** A missing, malformed or unreadable position means "start at the top". */
export function loadPosition<T>(
  projectId: string,
  prefix: string,
  decode: (value: unknown) => T | null,
  storage?: Storage
): T | null {
  try {
    const store = storage ?? window.sessionStorage;
    const raw = store.getItem(`${prefix}${projectId}`);
    if (raw === null) {
      return null;
    }
    return decode(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Best-effort write: losing a scroll offset is preferable to a crash. */
export function savePosition<T>(
  projectId: string,
  prefix: string,
  position: T,
  storage?: Storage
): void {
  try {
    const store = storage ?? window.sessionStorage;
    store.setItem(`${prefix}${projectId}`, JSON.stringify(position));
  } catch {
    // The view still works; only the next return starts at the top.
  }
}
