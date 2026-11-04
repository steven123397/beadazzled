import { useRef } from 'react';

import { useI18n } from '@/lib/i18n/I18nProvider';

import { formatKeys } from './resolve';
import type { Shortcut, ShortcutGroup } from './types';
import { useFocusTrap } from './useFocusTrap';

const GROUP_ORDER: ShortcutGroup[] = ['General', 'Navigation', 'Views', 'Data', 'Help'];

export function HelpPanel({
  shortcuts,
  onClose,
}: {
  shortcuts: readonly Shortcut[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: shortcuts.filter((shortcut) => shortcut.group === group),
  })).filter(({ items }) => items.length > 0);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t('keyboard.title')}
      className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-black/60 p-8"
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-raised p-4 text-foreground">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">{t('keyboard.title')}</h1>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
          >
            {t('keyboard.close')}
          </button>
        </div>
        {groups.map(({ group, items }) => (
          <section key={group} className="mt-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(`keyboard.group.${group}`)}
            </h2>
            <dl className="mt-1 space-y-1">
              {items.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-foreground">{t(shortcut.labelKey)}</dt>
                  <dd className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
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
