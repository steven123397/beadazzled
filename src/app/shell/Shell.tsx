import { useCallback, useMemo, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import type { Issue } from '@/bindings/bd';
import { HelpPanel } from '@/app/keyboard/HelpPanel';
import type { Shortcut, ShortcutContext } from '@/app/keyboard/types';
import { useShortcuts } from '@/app/keyboard/useShortcuts';
import { CommandPalette } from '@/app/palette/CommandPalette';
import { buildCommands } from '@/app/palette/commands';

import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

export function Shell({ issues = [] }: { issues?: readonly Issue[] }) {
  const { snapshot, bd, reload } = useWorkspaceContext();
  const navigate = useNavigate();
  const project = activeWorkspace(snapshot);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const closeOverlay = useCallback(() => {
    setPaletteOpen(false);
    setHelpOpen(false);
  }, []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((collapsed) => !collapsed), []);

  const copyDiagnostics = useCallback(() => {
    const lines = [
      `bd: ${bd?.kind === 'ready' ? bd.version : (bd?.kind ?? 'unknown')}`,
      `workspace: ${project?.path ?? 'none'}`,
      `projectId: ${project?.projectId ?? 'none'}`,
      `view: ${window.location.hash}`,
    ];
    void navigator.clipboard?.writeText(lines.join('\n'));
  }, [bd, project]);

  const context: ShortcutContext = {
    navigate,
    openPalette,
    closeOverlay,
    refresh: () => void reload(),
    toggleSidebar,
  };

  const shortcuts = useMemo<Shortcut[]>(() => {
    const overlayOpen = paletteOpen || helpOpen;
    const list: Shortcut[] = [
      {
        id: 'palette',
        keys: 'mod+k',
        label: 'Command palette',
        group: 'General',
        run: (ctx) => ctx.openPalette(),
      },
      {
        id: 'close-overlay',
        keys: 'escape',
        label: 'Close overlay',
        group: 'General',
        when: () => overlayOpen,
        run: (ctx) => ctx.closeOverlay(),
      },
      {
        id: 'toggle-sidebar',
        keys: 'mod+b',
        label: 'Toggle sidebar',
        group: 'Views',
        when: () => !overlayOpen,
        run: (ctx) => ctx.toggleSidebar(),
      },
      {
        id: 'refresh',
        keys: 'mod+r',
        label: 'Refresh data',
        group: 'Data',
        when: () => !overlayOpen,
        run: (ctx) => ctx.refresh(),
      },
      {
        id: 'help',
        keys: '?',
        label: 'Keyboard shortcuts',
        group: 'Help',
        when: () => !overlayOpen,
        run: () => setHelpOpen(true),
      },
    ];

    if (project !== null) {
      const projectId = project.projectId;
      list.push(
        {
          id: 'go-list',
          keys: ['g', 'l'],
          label: 'Go to List',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/list`),
        },
        {
          id: 'go-board',
          keys: ['g', 'b'],
          label: 'Go to Board',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/board`),
        },
        {
          id: 'list',
          keys: 'mod+1',
          label: 'Go to List',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/list`),
        },
        {
          id: 'board',
          keys: 'mod+2',
          label: 'Go to Board',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/board`),
        }
      );
    }

    list.push({
      id: 'go-settings',
      keys: ['g', 's'],
      label: 'Go to Settings',
      group: 'Navigation',
      when: () => !overlayOpen,
      run: (ctx) => ctx.navigate('/settings'),
    });

    return list;
  }, [project, paletteOpen, helpOpen]);

  useShortcuts(shortcuts, context);

  const paletteCommands = useMemo(
    () =>
      buildCommands(issues, {
        navigate,
        refresh: () => void reload(),
        copyDiagnostics,
        project,
      }),
    [issues, navigate, reload, copyDiagnostics, project]
  );

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <TopBar project={project} />
      <div className="flex min-h-0 flex-1">
        <Sidebar project={project} collapsed={sidebarCollapsed} />
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <StatusBar />
      {helpOpen ? <HelpPanel shortcuts={shortcuts} onClose={closeOverlay} /> : null}
      {paletteOpen ? <CommandPalette commands={paletteCommands} onClose={closeOverlay} /> : null}
    </div>
  );
}
