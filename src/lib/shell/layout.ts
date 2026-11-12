import { readSetting, writeSetting } from '@/lib/persisted';

export const SIDEBAR_STORAGE_KEY = 'beadazzled.sidebar.collapsed';

/**
 * Reads the saved preference. Storage can throw (disabled cookies, a locked
 * profile), and an unreadable or unrecognised value must not break the shell,
 * so anything unexpected means "expanded".
 */
export function loadSidebarCollapsed(storage?: Storage): boolean {
  return readSetting(SIDEBAR_STORAGE_KEY, (stored) => stored === 'true', false, storage);
}

/** Best-effort write: losing the preference is preferable to a crash on toggle. */
export function saveSidebarCollapsed(collapsed: boolean, storage?: Storage): void {
  writeSetting(SIDEBAR_STORAGE_KEY, (value) => (value ? 'true' : 'false'), collapsed, storage);
}
