import type { MessageKey } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import type { Theme } from '@/lib/theme/theme';

/** Shared by General (the controls) and About (the runtime summary). */
export const LANGUAGE_LABELS: Record<Language, MessageKey> = {
  en: 'language.en',
  'zh-CN': 'language.zh-CN',
};

export const THEME_LABELS: Record<Theme, MessageKey> = {
  light: 'theme.light',
  dark: 'theme.dark',
  system: 'theme.system',
};
