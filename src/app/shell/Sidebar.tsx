import { NavLink } from 'react-router-dom';

import type { WorkspaceEntry } from '@/bindings/bd';

const LINK_CLASS = 'block rounded px-2 py-1.5 text-sm';
const ACTIVE_CLASS = 'bg-neutral-800 text-neutral-100';
const IDLE_CLASS = 'text-neutral-400';

export function Sidebar({
  project,
  collapsed = false,
}: {
  project: WorkspaceEntry | null;
  collapsed?: boolean;
}) {
  const labelClass = collapsed ? 'sr-only' : '';

  return (
    <aside
      aria-label="Sidebar"
      data-collapsed={collapsed}
      className={`${collapsed ? 'w-10' : 'w-44'} shrink-0 border-r border-neutral-800 p-2`}
    >
      {project === null ? (
        <p className="px-2 py-1.5 text-xs text-neutral-500" title="No workspace open">
          <span className={collapsed ? 'sr-only' : ''}>No workspace open</span>
        </p>
      ) : (
        <nav aria-label="Views" className="space-y-0.5">
          <NavLink
            to={`/w/${project.projectId}/list`}
            className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
            title="List"
          >
            <span className={labelClass}>List</span>
          </NavLink>
          <NavLink
            to={`/w/${project.projectId}/board`}
            className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
            title="Board"
          >
            <span className={labelClass}>Board</span>
          </NavLink>
        </nav>
      )}
      <nav aria-label="App" className="mt-2 space-y-0.5 border-t border-neutral-800 pt-2">
        <NavLink
          to="/settings"
          className={({ isActive }) => `${LINK_CLASS} ${isActive ? ACTIVE_CLASS : IDLE_CLASS}`}
          title="Settings"
        >
          <span className={labelClass}>Settings</span>
        </NavLink>
      </nav>
    </aside>
  );
}
