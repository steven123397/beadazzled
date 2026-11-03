import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useWorkspaceContext } from './WorkspaceProvider';

import { messageOf } from '@/lib/errors';

import type { Language } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';
import type { Theme } from '@/lib/theme/theme';
import { useTheme } from '@/lib/theme/ThemeProvider';

export type PreferencesApi = {
  /** Writes the pair to the registry; rejects when the config write fails. */
  setPreferences(language: Language, theme: Theme): Promise<unknown>;
};

type PreferencesControl = {
  /** Last failed registry write, or null. A failed write keeps this session's choice. */
  error: string | null;
};

const PreferencesContext = createContext<PreferencesControl>({ error: null });

type Pair = { language: Language; theme: Theme };

/**
 * Keeps the language/theme providers and the Rust registry in step.
 *
 * The registry is the source of truth: `localStorage` only supplies the value
 * that lets the first paint happen before IPC answers, so the first snapshot
 * overwrites it. Each later change is written once, and the hydration itself is
 * not written back.
 */
export function PreferencesBridge({
  api,
  children,
}: {
  api: PreferencesApi;
  children?: ReactNode;
}) {
  const { snapshot } = useWorkspaceContext();
  const { language, setLanguage } = useI18n();
  const { preference, setPreference } = useTheme();
  const [error, setError] = useState<string | null>(null);
  // The pair the registry is known to hold; null until the first snapshot.
  // Storing it instead of a boolean flag means hydration that changes nothing
  // does not arm the writer, and a failed write is retried on the next change.
  const saved = useRef<Pair | null>(null);
  // Hydration updates the providers, and the passive writer for that commit
  // still sees the pre-hydration values. This flag skips exactly that pass so
  // adopting the registry never writes back to it.
  const skipHydrationPass = useRef(false);

  useEffect(() => {
    if (saved.current !== null || snapshot === null) {
      return;
    }
    const config = { language: snapshot.config.language, theme: snapshot.config.theme };
    saved.current = config;
    const changing = language !== config.language || preference !== config.theme;
    skipHydrationPass.current = changing;
    if (language !== config.language) {
      setLanguage(config.language);
    }
    if (preference !== config.theme) {
      setPreference(config.theme);
    }
  }, [snapshot, language, preference, setLanguage, setPreference]);

  useEffect(() => {
    if (saved.current === null) {
      return;
    }
    if (skipHydrationPass.current) {
      skipHydrationPass.current = false;
      return;
    }
    if (saved.current.language === language && saved.current.theme === preference) {
      return;
    }
    saved.current = { language, theme: preference };
    void api.setPreferences(language, preference).then(
      () => setError(null),
      (reason: unknown) => setError(messageOf(reason))
    );
  }, [api, language, preference]);

  const value = useMemo(() => ({ error }), [error]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferenceWriteError(): string | null {
  return useContext(PreferencesContext).error;
}
