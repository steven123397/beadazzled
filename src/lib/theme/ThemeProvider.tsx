import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  applyTheme,
  loadTheme,
  resolveTheme,
  saveTheme,
  systemPrefersDark,
  type ResolvedTheme,
  type Theme,
} from './theme';

export type ThemeControl = {
  preference: Theme;
  resolved: ResolvedTheme;
  setPreference: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeControl | null>(null);

export function ThemeProvider({
  children,
  initialPreference = loadTheme(),
}: {
  children: ReactNode;
  initialPreference?: Theme;
}) {
  const [preference, setPreferenceState] = useState<Theme>(initialPreference);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    applyTheme(document.documentElement, resolved);
  }, [resolved]);

  const setPreference = useCallback((next: Theme) => {
    setPreferenceState(next);
    saveTheme(next);
  }, []);

  const value = useMemo<ThemeControl>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeControl {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
