import { useState, type KeyboardEvent } from 'react';

import type { Comment } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/time';

export type CommentsProps = {
  comments?: readonly Comment[];
  /** Omitted on the read-only page: no composer is rendered. */
  onSubmit?: (text: string) => Promise<boolean>;
  pending?: boolean;
  disabled?: boolean;
  error?: string | null;
};

export function Comments({
  comments,
  onSubmit,
  pending = false,
  disabled = false,
  error = null,
}: CommentsProps) {
  const { t, language } = useI18n();
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ordered = [...(comments ?? [])].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)
  );
  const busy = pending || submitting;
  const canSubmit = !busy && !disabled && draft.trim() !== '';

  const submit = () => {
    if (!canSubmit || onSubmit === undefined) {
      return;
    }
    const text = draft;
    setSubmitting(true);
    void onSubmit(text)
      .then((saved) => {
        if (saved) {
          setDraft('');
        }
      })
      .finally(() => setSubmitting(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section aria-labelledby="detail-comments" className="mt-8 border-t border-border pt-5">
      <h2 id="detail-comments" className="text-sm font-semibold">
        {t('detail.comments')}
        {ordered.length > 0 ? ` (${ordered.length})` : ''}
      </h2>
      {ordered.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('detail.comments.empty')}</p>
      ) : (
        <ol aria-label={t('detail.comments')} className="mt-3 space-y-4">
          {ordered.map((comment) => (
            <li key={comment.id}>
              <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{comment.author}</span>
                <time
                  dateTime={comment.created_at}
                  title={formatAbsoluteTime(comment.created_at, language)}
                >
                  {formatRelativeTime(comment.created_at, language)}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{comment.text}</p>
            </li>
          ))}
        </ol>
      )}

      {onSubmit === undefined ? null : (
        <div className="mt-4">
          <textarea
            id="detail-comment-input"
            aria-label={t('detail.comment.placeholder')}
            placeholder={t('detail.comment.placeholder')}
            value={draft}
            disabled={disabled || busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            className="w-full rounded border border-border bg-background p-2 text-sm"
          />
          {error === null ? null : (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="mt-2 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          >
            {t('detail.comment.submit')}
          </button>
        </div>
      )}
    </section>
  );
}