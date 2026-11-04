import type { ReactNode } from 'react';

import { LANGUAGES, type Language } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { THEMES, type Theme } from '@/lib/theme/theme';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { usePreferenceWriteError } from '@/app/shell/PreferencesBridge';
import { PopoverSelect } from '@/components/ui/popover-select';

import { LANGUAGE_LABELS, THEME_LABELS } from './labels';

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
      <h2 id="settings-general" className="text-lg font-semibold">
        {t('settings.general')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('settings.language')}>
          <PopoverSelect
            label={t('settings.language')}
            value={language}
            options={LANGUAGES.map((value) => ({
              value,
              label: t(LANGUAGE_LABELS[value]),
            }))}
            onChange={(next) => setLanguage(next as Language)}
            size="md"
            className="w-full"
            triggerClassName="w-full justify-between"
            panelClassName="w-full"
          />
        </Field>
        <Field label={t('settings.theme')}>
          <PopoverSelect
            label={t('settings.theme')}
            value={preference}
            options={THEMES.map((value) => ({
              value,
              label: t(THEME_LABELS[value]),
            }))}
            onChange={(next) => setPreference(next as Theme)}
            size="md"
            className="w-full"
            triggerClassName="w-full justify-between"
            panelClassName="w-full"
          />
        </Field>
      </div>
      {saveError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {t('settings.saveFailed', { error: saveError })}
        </p>
      )}
    </section>
  );
}

/** A stacked field: the caption sits above a full-width control. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
