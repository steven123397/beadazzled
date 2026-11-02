import type { Comment } from '@/bindings/bd';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/time';

export function Comments({ comments }: { comments?: readonly Comment[] }) {
  const { t, language } = useI18n();
  const ordered = [...(comments ?? [])].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)
  );

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
                <time dateTime={comment.created_at} title={formatAbsoluteTime(comment.created_at, language)}>
                  {formatRelativeTime(comment.created_at, language)}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{comment.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}