import type { WorkspaceEntry } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';

export function TopBar({
  project,
  onRefresh,
}: {
  project: WorkspaceEntry | null;
  onRefresh: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="flex items-center gap-3 border-b border-border px-3 py-2">
      <h1 className="text-sm font-semibold tracking-tight">{t('app.name')}</h1>
      <span className="text-sm text-muted-foreground">
        {project?.name ?? t('shell.workspace.none')}
      </span>
      <div className="flex-1" />
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