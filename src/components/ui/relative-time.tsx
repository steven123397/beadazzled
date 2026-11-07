import { memo, type HTMLAttributes } from 'react';
import type { Language } from '@/lib/i18n';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/time';

export interface RelativeTimeProps extends HTMLAttributes<HTMLTimeElement> {
  value: string;
  language: Language;
}

export const RelativeTime = memo(function RelativeTime({
  value,
  language,
  className,
  ...props
}: RelativeTimeProps) {
  const absolute = formatAbsoluteTime(value, language);
  const relative = formatRelativeTime(value, language);

  return (
    <time dateTime={value} title={absolute} className={className} {...props}>
      {relative}
    </time>
  );
});
