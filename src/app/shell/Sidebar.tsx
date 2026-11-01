import { NavLink } from 'react-router-dom';

import type { WorkspaceEntry } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';

const LINK_CLASS = 'block rounded px-2 py-1.5 text-sm';
const ACTIVE_CLASS = 'bg-muted text-foreground';
const IDLE_CLASS = 'text-muted-foreground';

export function Sidebar({
  project,
  collapsed = false,
}: {
  project: WorkspaceEntry | null;
  collapsed?: boolean;
}) {
  const { t } = useI18n();
  const labelClass = collapsed ? 'sr-only' : '';

  return (
    <aside
      aria-label={t('shell.sidebar')}
      data-collapsed={collapsed}
      className={`${collapsed ? 'w-10' : 'w-44'} shrink-0 border-r border-border p-2`}
    >
      {project === null ? (
        <p
          className="px-2 py-1.5 text-xs text-muted-foreground"
          title={t('shell.workspace.noneOpen')}
        >
          <span className={collapsed ? 'sr-only' : ''}>{t('shell.workspace.noneOpen')}</span>
        </p>
      ) : (
        <nav aria-label={t('shell.views')} className="space-y-0.5">
          <NavLink
            to={`/w/${project.projectId}/list`}
            className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
            title={t('nav.list')}
          >
            <span className={labelClass}>{t('nav.list')}</span>
          </NavLink>
          <NavLink
            to={`/w/${project.projectId}/board`}
            className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
            title={t('nav.board')}
          >
            <span className={labelClass}>{t('nav.board')}</span>
          </NavLink>
        </nav>
      )}
      <nav aria-label={t('shell.app')} className="mt-2 space-y-0.5 border-t border-border pt-2">
        <NavLink
          to="/settings"
          className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
          title={t('nav.settings')}
        >
          <span className={labelClass}>{t('nav.settings')}</span>
        </NavLink>
      </nav>
    </aside>
  );
}
