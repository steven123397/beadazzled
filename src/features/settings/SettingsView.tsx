import { useI18n } from '@/lib/i18n/I18nProvider';

// Registers the settings catalog; the module lives in this route chunk so the
// copy never reaches the first-screen bundle.
import './messages';
import { AboutSection } from './AboutSection';
import { BdSection } from './BdSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { GeneralSection } from './GeneralSection';
import { SyncSection } from './SyncSection';
import { WorkspaceSection } from './WorkspaceSection';

/**
 * The full settings surface: general, bd, workspaces, sync, diagnostics and
 * about.
 *
 * Opening this page performs no bd call: only the explicit actions inside
 * BdSection and loading the diagnostics report do.
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
      <SyncSection />
      <DiagnosticsSection />
      <AboutSection />
    </section>
  );
}
