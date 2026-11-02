import { NavLink } from 'react-router-dom';

import type { WorkspaceEntry } from '@/bindings/bd';
import { confirmLeaveDraft } from '@/lib/draft-guard';
import { useI18n } from '@/lib/i18n/I18nProvider';

const LINK_CLASS = 'flex items-center gap-2 rounded px-2 py-1.5 text-sm';
const ACTIVE_CLASS = 'bg-muted text-foreground';
const IDLE_CLASS = 'text-muted-foreground';

/** Never unmount an open detail draft without asking first. */
function guardDraft(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (!confirmLeaveDraft()) {
    event.preventDefault();
  }
}

type IconName = 'list' | 'board' | 'settings' | 'collapse' | 'expand';

/** 14px line icons; the collapsed rail has nothing else to identify a view. */
const ICONS: Record<IconName, React.ReactNode> = {
  list: (
    <>
      <path d="M5.5 3.5h8M5.5 8h8M5.5 12.5h8" />
      <path d="M2.5 3.5h.01M2.5 8h.01M2.5 12.5h.01" />
    </>
  ),
  board: (
    <>
      <rect x="2" y="2" width="3" height="12" rx="1" />
      <rect x="6.5" y="2" width="3" height="8" rx="1" />
      <rect x="11" y="2" width="3" height="10" rx="1" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </>
  ),
  collapse: <path d="M10 3 5 8l5 5" />,
  expand: <path d="m6 3 5 5-5 5" />,
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {ICONS[name]}
    </svg>
  );
}

export function Sidebar({
  project,
  collapsed = false,
  onToggle,
}: {
  project: WorkspaceEntry | null;
  collapsed?: boolean;
  /** The rail stays reachable by mouse; Ctrl+B is not the only way back. */
  onToggle?: () => void;
}) {
  const { t } = useI18n();
  const labelClass = collapsed ? 'sr-only' : '';

  return (
    <aside
      aria-label={t('shell.sidebar')}
      data-collapsed={collapsed}
      className={`${collapsed ? 'w-10' : 'w-44'} flex shrink-0 flex-col border-r border-border p-2`}
    >
      {project === null ? (
        <p
          className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
          title={t('shell.workspace.noneOpen')}
        >
          <span className={collapsed ? 'sr-only' : ''}>{t('shell.workspace.noneOpen')}</span>
        </p>
      ) : (
        <nav aria-label={t('shell.views')} className="space-y-0.5">
          <NavLink
            to={`/w/${project.projectId}/list`}
            onClick={guardDraft}
            className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
            title={t('nav.list')}
          >
            <Icon name="list" />
            <span className={labelClass}>{t('nav.list')}</span>
          </NavLink>
          <NavLink
            to={`/w/${project.projectId}/board`}
            onClick={guardDraft}
            className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
            title={t('nav.board')}
          >
            <Icon name="board" />
            <span className={labelClass}>{t('nav.board')}</span>
          </NavLink>
        </nav>
      )}
      <nav aria-label={t('shell.app')} className="mt-2 space-y-0.5 border-t border-border pt-2">
        <NavLink
          to="/settings"
          onClick={guardDraft}
          className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
          title={t('nav.settings')}
        >
          <Icon name="settings" />
          <span className={labelClass}>{t('nav.settings')}</span>
        </NavLink>
      </nav>
      {onToggle === undefined ? null : (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
          aria-expanded={!collapsed}
          className="mt-auto flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} />
          <span className={labelClass}>
            {t(collapsed ? 'shell.sidebar.expand' : 'shell.sidebar.collapse')}
          </span>
        </button>
      )}
    </aside>
  );
}