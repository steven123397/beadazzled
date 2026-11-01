import { formatKeys } from './resolve';
import type { Shortcut, ShortcutGroup } from './types';

const GROUP_ORDER: ShortcutGroup[] = ['General', 'Navigation', 'Views', 'Data', 'Help'];

export function HelpPanel({
  shortcuts,
  onClose,
}: {
  shortcuts: readonly Shortcut[];
  onClose: () => void;
}) {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: shortcuts.filter((shortcut) => shortcut.group === group),
  })).filter(({ items }) => items.length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-black/60 p-8"
    >
      <div className="w-full max-w-lg rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">Keyboard shortcuts</h1>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-700 px-2 py-1 text-xs"
          >
            Close
          </button>
        </div>
        {groups.map(({ group, items }) => (
          <section key={group} className="mt-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {group}
            </h2>
            <dl className="mt-1 space-y-1">
              {items.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-neutral-300">{shortcut.label}</dt>
                  <dd className="rounded bg-neutral-900 px-2 py-0.5 font-mono text-xs text-neutral-400">
                    {formatKeys(shortcut.keys)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
