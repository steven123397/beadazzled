import type { WorkspaceEntry } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';

/**
 * The mouse path into the shell: switch workspace, open the palette, refresh.
 *
 * Switching only navigates — `ProjectGate` owns the actual switch, so the
 * pointer and a deep link take exactly the same code path.
 */
export function TopBar({
  project,
  workspaces,
  missing,
  onSwitch,
  onRefresh,
  onOpenPalette,
}: {
  project: WorkspaceEntry | null;
  workspaces: readonly WorkspaceEntry[];
  missing: readonly string[];
  onSwitch: (path: string) => void;
  onRefresh: () => void;
  onOpenPalette: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="flex items-center gap-3 border-b border-border px-3 py-2">
      <h1 className="text-sm font-semibold tracking-tight">{t('app.name')}</h1>
      {workspaces.length === 0 ? (
        <span className="text-sm text-muted-foreground">{t('shell.workspace.none')}</span>
      ) : (
        <select
          aria-label={t('topbar.workspace')}
          value={project?.path ?? ''}
          onChange={(event) => {
            if (event.target.value !== '') {
              onSwitch(event.target.value);
            }
          }}
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
        >
          {project === null ? (
            <option value="" disabled>
              {t('shell.workspace.none')}
            </option>
          ) : null}
          {workspaces.map((workspace) => (
            <option key={workspace.path} value={workspace.path}>
              {missing.includes(workspace.path)
                ? `${workspace.name} (${t('shell.workspace.missing')})`
                : workspace.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onOpenPalette}
        aria-keyshortcuts="Control+K"
        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
      >
        {t('topbar.commandPalette')}
      </button>
      <button
        type="button"
        onClick={onRefresh}
        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
      >
        {t('shell.refresh')}
      </button>
    </header>
  );
}