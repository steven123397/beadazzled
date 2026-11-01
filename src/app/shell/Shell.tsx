import { useCallback, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import type { Issue } from '@/bindings/bd';
import { HelpPanel } from '@/app/keyboard/HelpPanel';
import type { Shortcut, ShortcutContext } from '@/app/keyboard/types';
import { useShortcuts } from '@/app/keyboard/useShortcuts';
import { CommandPalette } from '@/app/palette/CommandPalette';
import { buildCommands } from '@/app/palette/commands';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { useTheme } from '@/lib/theme/ThemeProvider';

import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

export function Shell({ issues = [] }: { issues?: readonly Issue[] }) {
  const { t, language, setLanguage } = useI18n();
  const { preference, setPreference } = useTheme();
  const { snapshot, bd, reload } = useWorkspaceContext();
  const navigate = useNavigate();
  const location = useLocation();
  const project = activeWorkspace(snapshot);
  const onIssueRoute = /^\/w\/[^/]+\/issue\//.test(location.pathname);
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
    const version = bd?.kind === 'ready' ? bd.version : (bd?.kind ?? 'unknown');
    const lines = [
      t('diagnostics.bd', { version }),
      t('diagnostics.workspace', { path: project?.path ?? '-' }),
      t('diagnostics.project', { id: project?.projectId ?? '-' }),
      t('diagnostics.view', { view: window.location.hash || '#/' }),
    ];
    void navigator.clipboard?.writeText(lines.join('\n'));
  }, [bd, project, t]);

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
        labelKey: 'shortcut.palette',
        group: 'General',
        run: (ctx) => ctx.openPalette(),
      },
      {
        id: 'close-overlay',
        keys: 'escape',
        labelKey: 'shortcut.closeOverlay',
        group: 'General',
        when: () => overlayOpen,
        run: (ctx) => ctx.closeOverlay(),
      },
      {
        id: 'toggle-sidebar',
        keys: 'mod+b',
        labelKey: 'shortcut.toggleSidebar',
        group: 'Views',
        when: () => !overlayOpen,
        run: (ctx) => ctx.toggleSidebar(),
      },
      {
        id: 'refresh',
        keys: 'mod+r',
        labelKey: 'shortcut.refresh',
        group: 'Data',
        when: () => !overlayOpen,
        run: (ctx) => ctx.refresh(),
      },
      {
        id: 'help',
        keys: '?',
        labelKey: 'shortcut.help',
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
          labelKey: 'shortcut.list',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/list`),
        },
        {
          id: 'go-board',
          keys: ['g', 'b'],
          labelKey: 'shortcut.board',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/board`),
        },
        {
          id: 'list',
          keys: 'mod+1',
          labelKey: 'shortcut.list',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/list`),
        },
        {
          id: 'board',
          keys: 'mod+2',
          labelKey: 'shortcut.board',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(`/w/${projectId}/board`),
        }
      );
    }

    list.push({
      id: 'go-settings',
      keys: ['g', 's'],
      labelKey: 'shortcut.settings',
      group: 'Navigation',
      when: () => !overlayOpen,
      run: (ctx) => ctx.navigate('/settings'),
    });

    if (project !== null && onIssueRoute) {
      const projectId = project.projectId;
      list.push({
        id: 'back-to-list',
        keys: 'escape',
        labelKey: 'shortcut.back',
        group: 'Navigation',
        when: () => !overlayOpen,
        run: (ctx) => ctx.navigate(`/w/${projectId}/list`),
      });
    }

    return list;
  }, [project, paletteOpen, helpOpen, onIssueRoute]);

  useShortcuts(shortcuts, context);

  const paletteCommands = useMemo(
    () =>
      buildCommands(issues, {
        navigate,
        refresh: () => void reload(),
        copyDiagnostics,
        project,
        t,
        theme: preference,
        setTheme: setPreference,
        language,
        setLanguage,
      }),
    [
      issues,
      navigate,
      reload,
      copyDiagnostics,
      project,
      t,
      preference,
      setPreference,
      language,
      setLanguage,
    ]
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
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
