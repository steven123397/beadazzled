import type { MessageKey } from '@/lib/i18n';
import { LANGUAGES, type Language } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { THEMES, type Theme } from '@/lib/theme/theme';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { usePreferenceWriteError } from '@/app/shell/PreferencesBridge';
import { Select } from '@/components/ui/select';

const LANGUAGE_LABELS: Record<Language, MessageKey> = {
  en: 'language.en',
  'zh-CN': 'language.zh-CN',
};

const THEME_LABELS: Record<Theme, MessageKey> = {
  light: 'theme.light',
  dark: 'theme.dark',
  system: 'theme.system',
};

/**
 * Language and theme apply immediately; the registry write follows through
 * PreferencesBridge, so a failed save does not roll the screen back.
 */
export function GeneralSection() {
  const { t, language, setLanguage } = useI18n();
  const { preference, setPreference } = useTheme();
  const saveError = usePreferenceWriteError();

  return (
    <section aria-labelledby="settings-general" className="space-y-3">
      <h2 id="settings-general" className="text-sm font-semibold">
        {t('settings.general')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('settings.language')}</span>
          <Select
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
            className="border border-border bg-card"
          >
            {LANGUAGES.map((value) => (
              <option key={value} value={value}>
                {t(LANGUAGE_LABELS[value])}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">{t('settings.theme')}</span>
          <Select
            value={preference}
            onChange={(event) => setPreference(event.target.value as Theme)}
            className="border border-border bg-card"
          >
            {THEMES.map((value) => (
              <option key={value} value={value}>
                {t(THEME_LABELS[value])}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {saveError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {t('settings.saveFailed', { error: saveError })}
        </p>
      )}
    </section>
  );
}
