import { LayoutGrid, List, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import type { WorkspaceEntry } from '@/bindings/bd';
import { boardPath, listPath } from '@/app/paths';
import { navLinkClass } from '@/components/nav-link';
import { confirmLeaveDraft } from '@/lib/draft-guard';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { cn } from '@/lib/utils';

/** Never unmount an open detail draft without asking first. */
function guardDraft(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (!confirmLeaveDraft()) {
    event.preventDefault();
  }
}

function ViewLink({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return (
    <NavLink
      to={to}
      onClick={guardDraft}
      className={({ isActive }) => navLinkClass(isActive, true)}
    >
      {icon}
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export function Sidebar({
  project,
  collapsed = false,
}: {
  project: WorkspaceEntry | null;
  collapsed?: boolean;
}) {
  const { t } = useI18n();

  return (
    <aside
      id="app-sidebar"
      aria-label={t('shell.sidebar')}
      aria-hidden={collapsed ? true : undefined}
      inert={collapsed ? true : undefined}
      data-collapsed={collapsed}
      className={cn(
        'flex shrink-0 flex-col gap-0.5 overflow-hidden bg-background transition-[width,opacity,padding] duration-200 ease-out',
        collapsed ? 'pointer-events-none w-0 p-0 opacity-0' : 'w-44 p-2'
      )}
    >
      {project === null ? (
        <p className="flex h-control-sm items-center gap-2 px-2 text-sm text-muted-foreground">
          <span className="truncate">{t('shell.workspace.noneOpen')}</span>
        </p>
      ) : (
        <nav aria-label={t('shell.views')} className="flex flex-col gap-0.5">
          <ViewLink
            to={listPath(project.projectId)}
            label={t('nav.list')}
            icon={<List aria-hidden="true" className="size-3.5 shrink-0" />}
          />
          <ViewLink
            to={boardPath(project.projectId)}
            label={t('nav.board')}
            icon={<LayoutGrid aria-hidden="true" className="size-3.5 shrink-0" />}
          />
        </nav>
      )}
      <nav
        aria-label={t('shell.app')}
        className="mt-2 flex flex-col gap-0.5 border-t border-border-subtle pt-2"
      >
        <ViewLink
          to="/settings"
          label={t('nav.settings')}
          icon={<Settings aria-hidden="true" className="size-3.5 shrink-0" />}
        />
      </nav>
    </aside>
  );
}
