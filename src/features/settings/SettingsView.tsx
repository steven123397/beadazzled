import type { ComponentType } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';

import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { cn } from '@/lib/utils';

// Registers the settings catalog; the module lives in this route chunk so the
// copy never reaches the first-screen bundle.
import './messages';
import { AboutSection } from './AboutSection';
import { BdSection } from './BdSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { GeneralSection } from './GeneralSection';
import { SyncSection } from './SyncSection';
import { WorkspaceSection } from './WorkspaceSection';

const SECTIONS = ['general', 'bd', 'workspaces', 'sync', 'diagnostics', 'about'] as const;

type Section = (typeof SECTIONS)[number];

const SECTION_LABELS: Record<Section, MessageKey> = {
  general: 'settings.general',
  bd: 'settings.bd',
  workspaces: 'settings.workspaces',
  sync: 'settings.sync',
  diagnostics: 'settings.diagnostics',
  about: 'settings.about',
};

const SECTION_VIEWS: Record<Section, ComponentType> = {
  general: GeneralSection,
  bd: BdSection,
  workspaces: WorkspaceSection,
  sync: SyncSection,
  diagnostics: DiagnosticsSection,
  about: AboutSection,
};

const LINK_CLASS =
  'flex h-control-sm w-full items-center rounded-md px-2 text-sm transition-colors';
const ACTIVE_CLASS = 'bg-selected font-medium text-selected-foreground';
const IDLE_CLASS = 'text-muted-foreground hover:bg-hover hover:text-foreground';

function isSection(value: string | undefined): value is Section {
  return value !== undefined && (SECTIONS as readonly string[]).includes(value);
}

/**
 * The settings surface with one section per route (`#/settings/general`, …),
 * so a long list such as the workspace registry scrolls the page itself
 * instead of stretching one shared document.
 */
export function SettingsView() {
  const { t } = useI18n();
  const { section } = useParams<{ section: string }>();

  if (!isSection(section)) {
    return <Navigate to="/settings/general" replace />;
  }
  const Current = SECTION_VIEWS[section];

  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8 p-8">
      <nav aria-label={t('settings.sections')} className="w-40 shrink-0">
        <h1 id="settings-title" className="px-2 text-xl font-semibold">
          {t('nav.settings')}
        </h1>
        <ul className="mt-3 flex flex-col gap-0.5">
          {SECTIONS.map((key) => (
            <li key={key}>
              <NavLink
                to={`/settings/${key}`}
                className={({ isActive }) => cn(LINK_CLASS, isActive ? ACTIVE_CLASS : IDLE_CLASS)}
              >
                {t(SECTION_LABELS[key])}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">
        <Current />
      </div>
    </div>
  );
}
