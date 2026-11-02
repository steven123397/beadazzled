import { useParams } from 'react-router-dom';

import { useI18n } from '@/lib/i18n/I18nProvider';

/** Route target for a module that lands in a later phase. */
export function Placeholder({ titleKey }: { titleKey: 'nav.list' | 'nav.board' | 'nav.settings' }) {
  const { t } = useI18n();

  return (
    <section className="space-y-1 p-6">
      <h1 className="text-lg font-semibold">{t(titleKey)}</h1>
      <p className="text-sm text-muted-foreground">{t('placeholder.later')}</p>
    </section>
  );
}

export function IssuePlaceholder() {
  const { t } = useI18n();
  const { issueId } = useParams<{ issueId: string }>();

  return (
    <section className="space-y-1 p-6">
      <h1 className="text-lg font-semibold">{t('placeholder.issue', { id: issueId ?? '' })}</h1>
      <p className="text-sm text-muted-foreground">{t('placeholder.later')}</p>
    </section>
  );
}
