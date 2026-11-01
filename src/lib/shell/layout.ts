/** Sidebar width preference, persisted in the webview profile. */
export const SIDEBAR_STORAGE_KEY = 'beadazzled.sidebar.collapsed';

/**
 * Reads the saved preference. Storage can throw (disabled cookies, a locked
 * profile), and an unreadable or unrecognised value must not break the shell,
 * so anything unexpected means "expanded".
 */
export function loadSidebarCollapsed(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Best-effort write: losing the preference is preferable to a crash on toggle. */
export function saveSidebarCollapsed(collapsed: boolean, storage: Storage = localStorage): void {
  try {
    storage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'true' : 'false');
  } catch {
    // The toggle still works for this session; only persistence is lost.
  }
}