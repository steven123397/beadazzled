import type { WorkspaceEntry } from '@/bindings/bd';

import { useWorkspaceContext } from './WorkspaceProvider';

export function TopBar({ project }: { project: WorkspaceEntry | null }) {
  const { reload } = useWorkspaceContext();

  return (
    <header className="flex items-center gap-3 border-b border-neutral-800 px-3 py-2">
      <h1 className="text-sm font-semibold tracking-tight">beadazzled</h1>
      <span className="text-sm text-neutral-400">{project?.name ?? 'No workspace'}</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => void reload()}
        className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300"
      >
        Refresh
      </button>
    </header>
  );
}
