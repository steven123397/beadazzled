export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEMES: Theme[] = ['light', 'dark', 'system'];

export const THEME_STORAGE_KEY = 'beadazzled.theme';

// Persisted in the webview profile for now; Settings (bza-gkx) will reconcile
// this with the Rust AppConfig theme field once it gets a command.

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveTheme(preference: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

export function nextTheme(preference: Theme): Theme {
  const index = THEMES.indexOf(preference);
  return THEMES[(index + 1) % THEMES.length];
}

export function applyTheme(root: HTMLElement, resolved: ResolvedTheme): void {
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

/** Reads the saved preference; an unreadable storage means "follow the system". */
export function loadTheme(storage: Storage = localStorage): Theme {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Best-effort write: a restricted profile keeps the choice for this session only. */
export function saveTheme(preference: Theme, storage: Storage = localStorage): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Nothing to do: the theme is already applied in memory.
  }
}
