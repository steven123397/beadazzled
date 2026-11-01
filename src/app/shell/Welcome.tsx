import type { WorkspaceSnapshot } from '@/bindings/bd';

import { SkeletonScreen } from './SkeletonScreen';
import { activeWorkspace, useWorkspaceContext } from './WorkspaceProvider';

/** Explains why the app cannot open a workspace, instead of showing a blank screen. */
export function Welcome() {
  const { snapshot, bd, loading, error, reload, refreshBd } = useWorkspaceContext();

  if (loading) {
    return <SkeletonScreen />;
  }

  return (
    <section aria-labelledby="welcome-title" className="mx-auto max-w-xl space-y-3 p-8">
      <h1 id="welcome-title" className="text-xl font-semibold">
        Welcome to beadazzled
      </h1>
      <p className="text-sm text-neutral-400">{blockerReason(snapshot, bd, error)}</p>
      <button
        type="button"
        onClick={() => {
          void reload();
          void refreshBd();
        }}
        className="rounded border border-neutral-700 px-3 py-1 text-sm"
      >
        Try again
      </button>
    </section>
  );
}

function blockerReason(
  snapshot: WorkspaceSnapshot | null,
  bd: ReturnType<typeof useWorkspaceContext>['bd'],
  error: string | null
): string {
  if (error !== null) {
    return error;
  }
  if (bd === null) {
    return 'Checking for bd…';
  }
  switch (bd.kind) {
    case 'ready':
      return activeWorkspace(snapshot) === null
        ? 'Add a beads workspace to get started.'
        : 'The workspace is still loading.';
    case 'not-found':
      return 'bd was not found. Install bd or set its path in Settings.';
    case 'unsupported':
      return `bd ${bd.found} is older than ${bd.min}. Upgrade bd to continue.`;
    case 'broken':
      return bd.error.message;
  }
}
