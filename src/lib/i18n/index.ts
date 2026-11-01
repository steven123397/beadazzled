import { en } from './en';
import { zhCN } from './zh-CN';

export type MessageKey = keyof typeof en;
export type Language = 'en' | 'zh-CN';

export const catalogs: Record<Language, Record<MessageKey, string>> = {
  en,
  'zh-CN': zhCN,
};

export const LANGUAGES: Language[] = ['en', 'zh-CN'];

export const LANGUAGE_STORAGE_KEY = 'beadazzled.language';

// Persisted in the webview profile for now; Settings (bza-gkx) will reconcile
// this with the Rust AppConfig language field once it gets a command.

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'zh-CN';
}

export function loadLanguage(storage: Storage = localStorage): Language {
  const stored = storage.getItem(LANGUAGE_STORAGE_KEY);
  return isLanguage(stored) ? stored : 'en';
}

export function saveLanguage(language: Language, storage: Storage = localStorage): void {
  storage.setItem(LANGUAGE_STORAGE_KEY, language);
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
