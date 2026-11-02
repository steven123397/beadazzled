import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Select } from '@/components/ui/select';
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
    <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
      <h1 className="text-xs font-semibold tracking-tight text-foreground">{t('app.name')}</h1>
      <span aria-hidden="true" className="text-border-strong">
        /
      </span>
      {workspaces.length === 0 ? (
        <span className="text-xs text-muted-foreground">{t('shell.workspace.none')}</span>
      ) : (
        <Select
          aria-label={t('topbar.workspace')}
          value={project?.path ?? ''}
          onChange={(event) => {
            if (event.target.value !== '') {
              onSwitch(event.target.value);
            }
          }}
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
        </Select>
      )}
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenPalette}
        aria-keyshortcuts="Control+K"
        className="text-muted-foreground"
      >
        {t('topbar.commandPalette')}
        <kbd className="rounded-sm border border-border px-1 py-px font-mono text-2xs text-muted-foreground">
          Ctrl K
        </kbd>
      </Button>
      <IconButton label={t('shell.refresh')} onClick={onRefresh} variant="ghost">
        <RefreshCw aria-hidden="true" className="size-3.5" />
      </IconButton>
    </header>
  );
}
