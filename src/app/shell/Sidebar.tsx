import { ChevronLeft, ChevronRight, LayoutGrid, List, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { WorkspaceEntry } from '@/bindings/bd';
import { confirmLeaveDraft } from '@/lib/draft-guard';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { cn } from '@/lib/utils';

const LINK_CLASS =
  'flex h-control-sm w-full items-center gap-2 rounded-md px-2 text-sm transition-colors';
const ACTIVE_CLASS = 'bg-selected font-medium text-selected-foreground';
const IDLE_CLASS = 'text-muted-foreground hover:bg-hover hover:text-foreground';

/** Never unmount an open detail draft without asking first. */
function guardDraft(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (!confirmLeaveDraft()) {
    event.preventDefault();
  }
}

function ViewLink({
  to,
  label,
  icon,
  collapsed,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  collapsed: boolean;
}) {
  const link = (
    <NavLink
      to={to}
      onClick={guardDraft}
      title={collapsed ? label : undefined}
      className={({ isActive }) => cn(LINK_CLASS, isActive ? ACTIVE_CLASS : IDLE_CLASS)}
    >
      {icon}
      <span className={collapsed ? 'sr-only' : 'truncate'}>{label}</span>
    </NavLink>
  );

  return collapsed ? (
    <Tooltip label={label} side="right" className="block w-full">
      {link}
    </Tooltip>
  ) : (
    link
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

  return (
    <aside
      aria-label={t('shell.sidebar')}
      data-collapsed={collapsed}
      className={cn(
        'flex shrink-0 flex-col gap-0.5 border-r border-border-subtle bg-background p-2',
        collapsed ? 'w-11' : 'w-44'
      )}
    >
      {project === null ? (
        <p className="flex h-control-sm items-center gap-2 px-2 text-xs text-muted-foreground">
          <span className={collapsed ? 'sr-only' : 'truncate'}>
            {t('shell.workspace.noneOpen')}
          </span>
        </p>
      ) : (
        <nav aria-label={t('shell.views')} className="flex flex-col gap-0.5">
          <ViewLink
            to={`/w/${project.projectId}/list`}
            label={t('nav.list')}
            icon={<List aria-hidden="true" className="size-3.5 shrink-0" />}
            collapsed={collapsed}
          />
          <ViewLink
            to={`/w/${project.projectId}/board`}
            label={t('nav.board')}
            icon={<LayoutGrid aria-hidden="true" className="size-3.5 shrink-0" />}
            collapsed={collapsed}
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
          collapsed={collapsed}
        />
      </nav>
      {onToggle === undefined ? null : (
        <div className="mt-auto">
          <Tooltip
            label={t(collapsed ? 'shell.sidebar.expand' : 'shell.sidebar.collapse')}
            side="right"
            className="block w-full"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              aria-label={t(collapsed ? 'shell.sidebar.expand' : 'shell.sidebar.collapse')}
              aria-expanded={!collapsed}
              className="w-full justify-start px-2 text-xs text-muted-foreground"
            >
              {collapsed ? (
                <ChevronRight aria-hidden="true" className="size-3.5" />
              ) : (
                <ChevronLeft aria-hidden="true" className="size-3.5" />
              )}
              <span className={collapsed ? 'sr-only' : 'truncate'}>
                {t(collapsed ? 'shell.sidebar.expand' : 'shell.sidebar.collapse')}
              </span>
            </Button>
          </Tooltip>
        </div>
      )}
    </aside>
  );
}
