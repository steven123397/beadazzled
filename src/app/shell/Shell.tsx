import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, type NavigateOptions } from 'react-router-dom';

import type { Issue } from '@/bindings/bd';
import { HelpPanel } from '@/app/keyboard/HelpPanel';
import type { Shortcut, ShortcutContext } from '@/app/keyboard/types';
import { useShortcuts } from '@/app/keyboard/useShortcuts';
import { CommandPalette } from '@/app/palette/CommandPalette';
import { buildCommands, type CommandItem } from '@/app/palette/commands';
import { boardPath, isIssuePath, listPath } from '@/app/paths';
import { CopyNotice, useCopy } from '@/components/ui/copy-notice';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { useAppVersion } from '@/lib/app-version';
import { formatDiagnostics } from '@/lib/diagnostics';
import { confirmLeaveDraft } from '@/lib/draft-guard';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '@/lib/shell/layout';
import { useTheme } from '@/lib/theme/ThemeProvider';

import { AppRefreshProvider } from './AppRefresh';
import { Diagnostics } from './Diagnostics';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { useSyncState } from './SyncStatus';
import { TopBar } from './TopBar';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

const EMPTY_COMMANDS: readonly CommandItem[] = [];

export function Shell({
  issues = [],
  onRefresh,
  lastSeq = 0,
  pendingWrites = 0,
}: {
  issues?: readonly Issue[];
  onRefresh?: () => void;
  /** Journal position reported by the sync store; 0 when sync is not running. */
  lastSeq?: number;
  /** Writes waiting behind the in-flight one; the write flow lands in bza-um8. */
  pendingWrites?: number;
}) {
  const { t, language, setLanguage } = useI18n();
  const { preference, setPreference } = useTheme();
  const { snapshot, bd, error, reload } = useWorkspaceContext();
  const syncState = useSyncState();
  const routerNavigate = useNavigate();
  // Every shell-initiated view change goes through the draft guard; links in
  // the sidebar use the same helper on their own click handler.
  const navigate = useCallback(
    (path: string, options?: NavigateOptions) => {
      if (confirmLeaveDraft()) {
        routerNavigate(path, options);
      }
    },
    [routerNavigate]
  );
  const location = useLocation();
  // The route on screen right now, for the traversal guard below: React Router
  // has already moved to the popped entry when the popstate listener runs.
  const locationRef = useRef(location);
  locationRef.current = location;
  const project = activeWorkspace(snapshot);
  const onIssueRoute = isIssuePath(location.pathname);
  type Overlay = 'palette' | 'help' | 'diagnostics' | null;
  const [overlay, setOverlay] = useState<Overlay>(null);
  // Read once at mount so a restored collapse never renders expanded first.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const appVersion = useAppVersion();
  const [lastRefreshAt, setLastRefreshAt] = useState(() => Date.now());
  const { copyResult: copyNotice, copy: copyDiagnosticsText } = useCopy({ timeoutMs: 2500 });

  const refreshData = useMemo(() => onRefresh ?? (() => void reload()), [onRefresh, reload]);
  const refresh = useCallback(() => {
    refreshData();
    setLastRefreshAt(Date.now());
  }, [refreshData]);
  const appRefresh = useMemo(() => ({ lastRefreshAt, refresh }), [lastRefreshAt, refresh]);

  useEffect(() => {
    saveSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Back/forward gestures reach the browser history directly, so navigate()
  // never sees them. The traversal is already applied when popstate fires;
  // an unconfirmed draft puts the route that was on screen back.
  useEffect(() => {
    const handler = () => {
      if (confirmLeaveDraft()) {
        return;
      }
      const previous = locationRef.current;
      routerNavigate(`${previous.pathname}${previous.search}${previous.hash}`, { replace: true });
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [routerNavigate]);

  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openPalette = useCallback(() => setOverlay('palette'), []);
  const openDiagnostics = useCallback(() => setOverlay('diagnostics'), []);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((collapsed) => !collapsed), []);

  // A pointer switch is just navigation: ProjectGate performs (and reports) the
  // real switch, exactly as it does for a deep link.
  const switchWorkspace = useCallback(
    (path: string) => {
      const entry = snapshot?.config.workspaces.find((workspace) => workspace.path === path);
      if (entry !== undefined) {
        navigate(listPath(entry.projectId), { replace: true });
      }
    },
    [snapshot, navigate]
  );

  // One payload for the palette action and the diagnostics panel, so the two
  // copies never drift apart.
  const diagnosticsText = useCallback(
    () =>
      formatDiagnostics({
        appVersion,
        bdVersion: bd === null ? null : bd.kind === 'ready' ? bd.version : bd.kind,
        bdPath: bd !== null && 'path' in bd ? bd.path : null,
        workspace: project?.path ?? null,
        project: project?.projectId ?? null,
        // The shell does not ask bd for a context; Settings fills these in.
        doltMode: null,
        schema: null,
        sync: syncState.kind,
        lastSeq,
        lastRefreshAt: new Date(lastRefreshAt).toISOString(),
        error,
      }),
    [appVersion, bd, project, lastSeq, syncState, lastRefreshAt, error]
  );

  const copyDiagnostics = useCallback(() => {
    void copyDiagnosticsText(diagnosticsText());
  }, [copyDiagnosticsText, diagnosticsText]);

  const context: ShortcutContext = {
    navigate,
    openPalette,
    closeOverlay,
    refresh,
    toggleSidebar,
  };

  const shortcuts = useMemo<Shortcut[]>(() => {
    const overlayOpen = overlay !== null;
    const list: Shortcut[] = [
      {
        id: 'palette',
        keys: 'mod+k',
        labelKey: 'shortcut.palette',
        group: 'General',
        // One modal at a time: opening the palette under diagnostics would mount
        // two focus traps and leave the newer backdrop covering the palette.
        when: () => !overlayOpen,
        run: (ctx) => ctx.openPalette(),
      },
      {
        id: 'close-overlay',
        keys: 'escape',
        labelKey: 'shortcut.closeOverlay',
        group: 'General',
        // Escape is the way out of a modal even when a draft guard suppresses
        // the other single-key shortcuts; `when` keeps it scoped to overlays.
        allowInInput: true,
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
        run: () => setOverlay('help'),
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
          run: (ctx) => ctx.navigate(listPath(projectId)),
        },
        {
          id: 'go-board',
          keys: ['g', 'b'],
          labelKey: 'shortcut.board',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(boardPath(projectId)),
        },
        {
          id: 'list',
          keys: 'mod+1',
          labelKey: 'shortcut.list',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(listPath(projectId)),
        },
        {
          id: 'board',
          keys: 'mod+2',
          labelKey: 'shortcut.board',
          group: 'Navigation',
          when: () => !overlayOpen,
          run: (ctx) => ctx.navigate(boardPath(projectId)),
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
        run: (ctx) => ctx.navigate(listPath(projectId)),
      });
    }

    return list;
  }, [project, overlay, onIssueRoute]);

  useShortcuts(shortcuts, context);

  const paletteCommands = useMemo(() => {
    if (overlay !== 'palette') {
      return EMPTY_COMMANDS;
    }
    return buildCommands(issues, {
      navigate,
      refresh,
      copyDiagnostics,
      project,
      t,
      theme: preference,
      setTheme: setPreference,
      language,
      setLanguage,
    });
  }, [
    overlay,
    issues,
    navigate,
    refresh,
    copyDiagnostics,
    project,
    t,
    preference,
    setPreference,
    language,
    setLanguage,
  ]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar
        project={project}
        workspaces={snapshot?.config.workspaces ?? []}
        missing={snapshot?.missing ?? []}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onSwitch={switchWorkspace}
        onRefresh={refresh}
        onOpenPalette={openPalette}
      />
      <div className="flex min-h-0 flex-1 pb-2 pr-2">
        <Sidebar project={project} collapsed={sidebarCollapsed} />
        {/* The content column is its own panel: the sidebar sits on the app
            background, and every screen paints inside this card. */}
        <main className="thin-scrollbar ml-2 mt-2 min-w-0 flex-1 overflow-auto rounded-lg border border-border bg-card shadow-xs">
          <AppRefreshProvider value={appRefresh}>
            <Outlet />
          </AppRefreshProvider>
        </main>
      </div>
      <StatusBar lastRefreshAt={lastRefreshAt} open={overlay === 'diagnostics'} onOpen={openDiagnostics} />
      {overlay === 'help' ? <HelpPanel shortcuts={shortcuts} onClose={closeOverlay} /> : null}
      {overlay === 'palette' ? <CommandPalette commands={paletteCommands} onClose={closeOverlay} /> : null}
      {overlay === 'diagnostics' ? (
        <Diagnostics
          lastSeq={lastSeq}
          lastRefreshAt={lastRefreshAt}
          pendingWrites={pendingWrites}
          onCopy={copyDiagnostics}
          onClose={closeOverlay}
        />
      ) : null}
      {/* Mounted for the lifetime of the shell: a region inserted together
          with its text is not announced. It only becomes visible when there
          is a result to show. */}
      <CopyNotice result={copyNotice} variant="toast" />
    </div>
  );
}
