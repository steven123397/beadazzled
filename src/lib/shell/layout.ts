export const SIDEBAR_STORAGE_KEY = 'beadazzled.sidebar.collapsed';

/**
 * Reads the saved preference. Storage can throw (disabled cookies, a locked
 * profile), and an unreadable or unrecognised value must not break the shell,
 * so anything unexpected means "expanded".
 */
export function loadSidebarCollapsed(storage?: Storage): boolean {
  try {
    // Resolved inside the try: reading `window.localStorage` itself throws when
    // storage is disabled, and a default parameter would evaluate first.
    const store = storage ?? window.localStorage;
    return store.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Best-effort write: losing the preference is preferable to a crash on toggle. */
export function saveSidebarCollapsed(collapsed: boolean, storage?: Storage): void {
  try {
    (storage ?? window.localStorage).setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'true' : 'false');
  } catch {
    // The toggle still works for this session; only persistence is lost.
  }
}
