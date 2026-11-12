import { readSetting, writeSetting } from '@/lib/persisted';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEMES: Theme[] = ['light', 'dark', 'system'];

export const THEME_STORAGE_KEY = 'beadazzled.theme';

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
export function loadTheme(storage?: Storage): Theme {
  return readSetting(
    THEME_STORAGE_KEY,
    (stored) => (isTheme(stored) ? stored : 'system'),
    'system',
    storage
  );
}

/** Best-effort write: a restricted profile keeps the choice for this session only. */
export function saveTheme(preference: Theme, storage?: Storage): void {
  writeSetting(THEME_STORAGE_KEY, (value) => value, preference, storage);
}
