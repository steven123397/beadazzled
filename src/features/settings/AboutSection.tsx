import { ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import appIcon from '@/assets/app-icon.svg';
import type { BdStatus } from '@/bindings/bd';
import { activeWorkspace, useWorkspaceContext } from '@/app/shell/WorkspaceProvider';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAppVersion } from '@/lib/app-version';
import { messageOf } from '@/lib/errors';
import { useI18n } from '@/lib/i18n/I18nProvider';
import type { MessageKey } from '@/lib/i18n';
import { openExternal } from '@/lib/links';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { cn } from '@/lib/utils';

import { LANGUAGE_LABELS, THEME_LABELS } from './labels';

const REPOSITORY_URL = 'https://github.com/steven123397/beadazzled';

const LINKS: readonly { href: string; labelKey: MessageKey; label: string }[] = [
  { href: REPOSITORY_URL, labelKey: 'settings.about.links.source', label: 'GitHub' },
  {
    href: `${REPOSITORY_URL}/tree/main/docs`,
    labelKey: 'settings.about.links.docs',
    label: 'docs/',
  },
  {
    href: `${REPOSITORY_URL}/issues`,
    labelKey: 'settings.about.links.issues',
    label: 'GitHub Issues',
  },
  {
    href: `${REPOSITORY_URL}/blob/main/LICENSE`,
    labelKey: 'settings.about.links.license',
    label: 'MIT',
  },
];

/**
 * Version, links and runtime facts. The update check stays disabled until the
 * updater ships with the release build (bza-058); showing an enabled button
 * that does nothing would be worse than saying so.
 */
export function AboutSection() {
  const { t, language } = useI18n();
  const version = useAppVersion();
  const { preference } = useTheme();
  const { snapshot, bd } = useWorkspaceContext();
  const [linkError, setLinkError] = useState<string | null>(null);
  const entry = activeWorkspace(snapshot);

  async function openLink(href: string): Promise<void> {
    setLinkError(null);
    try {
      await openExternal(href);
    } catch (error) {
      setLinkError(messageOf(error));
    }
  }

  return (
    <section aria-labelledby="settings-about" className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <img src={appIcon} alt="" width={56} height={56} className="size-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id="settings-about" className="text-xl font-semibold">
            beadazzled
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('settings.about.tagline')}
            {version === null ? null : ` · ${t('settings.about.version', { version })}`}
          </p>
        </div>
        <Button size="md" variant="secondary" disabled title={t('settings.about.updatesLater')}>
          <RefreshCw aria-hidden="true" className="size-3.5" />
          {t('settings.about.checkUpdates')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.about.updatesLater')}</p>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('settings.about.links')}</h3>
        <ul className="divide-y divide-border rounded-md border border-border bg-raised">
          {LINKS.map((link) => (
            <li key={link.href} className="flex items-center justify-between gap-4 px-3 py-2">
              <span className="text-xs">{t(link.labelKey)}</span>
              <a
                href={link.href}
                onClick={(event) => {
                  // Always handled here: a plain anchor would navigate the
                  // webview away from the app shell.
                  event.preventDefault();
                  void openLink(link.href);
                }}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
              >
                {link.label}
                <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      </div>

      {linkError === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {linkError}
        </p>
      )}

      <details className="group rounded-md border border-border bg-raised">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-hover">
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
          {t('settings.about.runtime')}
        </summary>
        <dl className="space-y-1 border-t border-border px-3 py-2.5 text-xs">
          <InfoRow
            label={t('settings.about.runtime.app')}
            value={version ?? t('settings.about.runtime.unknown')}
          />
          <InfoRow label={t('settings.about.runtime.bd')} value={describeBd(bd)} />
          <InfoRow label={t('settings.about.runtime.workspace')} value={entry?.path ?? '-'} />
          <InfoRow label={t('settings.about.runtime.project')} value={entry?.projectId ?? '-'} />
          <InfoRow label={t('settings.about.runtime.theme')} value={t(THEME_LABELS[preference])} />
          <InfoRow
            label={t('settings.about.runtime.language')}
            value={t(LANGUAGE_LABELS[language])}
          />
        </dl>
        <div className="border-t border-border px-3 py-2">
          <Link to="/settings/diagnostics" className="text-xs text-primary-text hover:underline">
            {t('settings.about.openDiagnostics')}
          </Link>
        </div>
      </details>
    </section>
  );
}

function describeBd(bd: BdStatus | null): string {
  if (bd === null) {
    return '-';
  }
  return bd.kind === 'ready' ? `${bd.version} · ${bd.path}` : bd.kind;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-right">{value}</dd>
    </div>
  );
}
