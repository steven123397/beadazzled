import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Issue } from '@/bindings/bd';
import { copyText } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n/I18nProvider';

import { statusText } from '@/lib/status';

export function Header({
  issue,
  onBack,
  onEditTitle,
  hideTitle = false,
}: {
  issue: Issue;
  onBack: () => void;
  onEditTitle?: () => void;
  hideTitle?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copyId = () => {
    void copyText(issue.id).then((result) => setCopied(result === 'copied'));
  };

  return (
    <header>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Button variant="ghost" aria-label={t('detail.back')} onClick={onBack}>
          ← {t('detail.back')}
        </Button>
        <span className="font-mono">{issue.id}</span>
        <Button variant="ghost" aria-label={t('detail.copyId')} onClick={copyId}>
          {copied ? t('clipboard.copied') : '#'}
        </Button>
        <span className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="text-foreground">
            {statusText(issue.status, t)}
          </Badge>
          <span className="tabular-nums">P{issue.priority}</span>
          <span>{issue.issue_type}</span>
        </span>
      </div>
      {hideTitle ? null : (
        <h1 className="mt-3 text-xl font-semibold leading-tight">
          {onEditTitle === undefined ? (
            issue.title
          ) : (
            <button
              type="button"
              onClick={onEditTitle}
              className="-mx-1 rounded-sm px-1 text-left hover:bg-hover"
              title={t('detail.edit.edit')}
            >
              {issue.title}
            </button>
          )}
        </h1>
      )}
    </header>
  );
}
