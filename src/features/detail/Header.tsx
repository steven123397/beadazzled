import { useState } from 'react';

import type { Issue } from '@/bindings/bd';
import { copyText } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { statusText } from '@/features/list/status';

export function Header({ issue, onBack }: { issue: Issue; onBack: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    void copyText(issue.id).then((result) => setCopied(result === 'copied'));
  };

  return (
    <header>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          aria-label={t('detail.back')}
          onClick={onBack}
          className="rounded border border-border px-2 py-1 text-foreground hover:bg-muted"
        >
          ← {t('detail.back')}
        </button>
        <span className="font-mono">{issue.id}</span>
        <button
          type="button"
          aria-label={t('detail.copyId')}
          onClick={copyId}
          className="rounded border border-border px-2 py-1 hover:bg-muted"
        >
          {copied ? t('clipboard.copied') : '#'}
        </button>
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded bg-muted px-2 py-0.5 text-foreground">
            {statusText(issue.status, t)}
          </span>
          <span className="tabular-nums">P{issue.priority}</span>
          <span>{issue.issue_type}</span>
        </span>
      </div>
      <h1 className="mt-3 text-xl font-semibold leading-snug">{issue.title}</h1>
    </header>
  );
}