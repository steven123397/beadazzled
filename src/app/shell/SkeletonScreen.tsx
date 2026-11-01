import { useI18n } from '@/lib/i18n/I18nProvider';

/** Busy placeholder for work that is loading; never an empty list or a blank pane. */
export function SkeletonScreen({ label }: { label?: string }) {
  const { t } = useI18n();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label ?? t('status.loadingWorkspace')}
      className="space-y-3 p-6"
    >
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-9 animate-pulse rounded bg-muted"
            style={{ animationDelay: `${index * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
