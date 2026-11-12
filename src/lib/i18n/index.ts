import { readSetting, writeSetting } from '@/lib/persisted';

import { en } from './en';
import { zhCN } from './zh-CN';

// Type-only: the settings chunk registers its own copy at runtime.
import type { SettingsMessageKey } from '@/features/settings/messages';

export type MessageKey = keyof typeof en | SettingsMessageKey;
export type Language = 'en' | 'zh-CN';

export const catalogs: Record<Language, Record<string, string>> = {
  // Copies, so a lazily registered screen never mutates the source modules.
  en: { ...en },
  'zh-CN': { ...zhCN },
};

/** Adds a lazily loaded screen's copy to the catalogs it belongs to. */
export function registerCatalog(language: Language, messages: Record<string, string>): void {
  Object.assign(catalogs[language], messages);
}

export const LANGUAGES: Language[] = ['en', 'zh-CN'];

export const LANGUAGE_STORAGE_KEY = 'beadazzled.language';

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'zh-CN';
}

/** Reads the saved language; an unreadable storage falls back to English. */
export function loadLanguage(storage?: Storage): Language {
  return readSetting(
    LANGUAGE_STORAGE_KEY,
    (stored) => (isLanguage(stored) ? stored : 'en'),
    'en',
    storage
  );
}

/** Best-effort write: a restricted profile keeps the choice for this session only. */
export function saveLanguage(language: Language, storage?: Storage): void {
  writeSetting(LANGUAGE_STORAGE_KEY, (value) => value, language, storage);
}

/** Looks up `key` and substitutes `{name}` placeholders from `vars`. */
export function translate(
  language: Language,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const template = catalogs[language][key] ?? key;
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}
