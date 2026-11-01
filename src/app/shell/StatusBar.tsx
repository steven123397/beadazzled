import { useSyncState, describeSyncState, syncToneClass } from './SyncStatus';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

export function StatusBar() {
  const { snapshot, bd, error } = useWorkspaceContext();
  const sync = useSyncState();
  const { label, tone } = describeSyncState(sync);
  const project = activeWorkspace(snapshot);

  return (
    <footer
      aria-label="Status bar"
      className="flex items-center gap-4 border-t border-neutral-800 px-3 py-1 text-xs text-neutral-400"
    >
      <span>{bd?.kind === 'ready' ? `bd ${bd.version}` : 'bd unknown'}</span>
      <span className="truncate">{project?.name ?? 'No workspace'}</span>
      <span className="min-w-0 flex-1 truncate text-red-400">{error ?? ''}</span>
      <span className={`font-medium ${syncToneClass(tone)}`}>{label}</span>
    </footer>
  );
}
