import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useAppVersion } from '@/lib/app-version';
import { messageOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { openExternal } from '@/lib/links';

const REPOSITORY_URL = 'https://github.com/steven123397/beadazzled';

/**
 * Version, license and repository. "Check for updates" stays disabled until
 * the updater ships with the release build (bza-058); showing an enabled
 * button that does nothing would be worse than saying so.
 */
export function AboutSection() {
  const { t } = useI18n();
  const version = useAppVersion();
  const [linkError, setLinkError] = useState<string | null>(null);

  async function openRepository(): Promise<void> {
    setLinkError(null);
    try {
      await openExternal(REPOSITORY_URL);
    } catch (error) {
      setLinkError(messageOf(error));
    }
  }

  return (
    <section aria-labelledby="settings-about" className="space-y-3">
      <h2 id="settings-about" className="text-sm font-semibold">
        {t('settings.about')}
      </h2>
      <div className="space-y-1 text-xs">
        {version === null ? null : <p>{t('settings.about.version', { version })}</p>}
        <p className="text-muted-foreground">{t('settings.about.license')}</p>
        <a
          href={REPOSITORY_URL}
          onClick={(event) => {
            // Always handled here: a plain anchor would navigate the webview
            // away from the app shell.
            event.preventDefault();
            void openRepository();
          }}
          className="inline-block text-foreground underline decoration-primary underline-offset-4 hover:decoration-2"
        >
          {t('settings.about.repository')}
        </a>
      </div>
      {linkError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {linkError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled title={t('settings.about.updatesLater')}>
          {t('settings.about.checkUpdates')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('settings.about.updatesLater')}</p>
      </div>
    </section>
  );
}
