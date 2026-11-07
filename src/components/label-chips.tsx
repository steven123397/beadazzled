import { useI18n } from '@/lib/i18n/I18nProvider';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface LabelChipsProps {
  labels: readonly string[];
  max?: number;
  badgeClassName?: string;
  extraClassName?: string;
  showTitle?: boolean;
  wrapperClassName?: string;
  wrapperTitle?: string;
}

export function LabelChips({
  labels,
  max = 2,
  badgeClassName,
  extraClassName,
  showTitle = false,
  wrapperClassName,
  wrapperTitle,
}: LabelChipsProps) {
  const { t } = useI18n();
  const visibleLabels = labels.slice(0, max);
  const extraLabels = labels.length - visibleLabels.length;
  const moreLabels = extraLabels > 0 ? t('list.moreLabels', { count: extraLabels }) : '';

  const content = (
    <>
      {visibleLabels.map((label, index) => (
        <Badge
          key={`${label}-${index}`}
          className={cn('min-w-0', badgeClassName)}
          title={showTitle ? label : undefined}
        >
          {showTitle ? <span className="min-w-0 truncate">{label}</span> : label}
        </Badge>
      ))}
      {extraLabels > 0 ? (
        <span className={cn('shrink-0', extraClassName)}>{moreLabels}</span>
      ) : null}
    </>
  );

  if (wrapperClassName !== undefined) {
    return (
      <span className={wrapperClassName} title={wrapperTitle}>
        {content}
      </span>
    );
  }

  return content;
}
