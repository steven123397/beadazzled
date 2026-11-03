import { useI18n } from '@/lib/i18n/I18nProvider';

import { AboutSection } from './AboutSection';
import { BdSection } from './BdSection';
import { GeneralSection } from './GeneralSection';
import { WorkspaceSection } from './WorkspaceSection';

/**
 * The settings surface for v0.1.0's general/bd/about blocks. Workspace,
 * sync and diagnostics blocks arrive with bza-082.
 *
 * Opening this page performs no bd call: only the explicit actions inside
 * BdSection do.
 */
export function SettingsView() {
  const { t } = useI18n();

  return (
    <section aria-labelledby="settings-title" className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 id="settings-title" className="text-xl font-semibold">
        {t('nav.settings')}
      </h1>
      <GeneralSection />
      <BdSection />
      <WorkspaceSection />
      <AboutSection />
    </section>
  );
}
