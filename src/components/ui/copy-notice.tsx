import { useCallback, useEffect, useState, type HTMLAttributes } from 'react';
import { copyText, type CopyResult } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { cn } from '@/lib/utils';

export interface UseCopyOptions {
  timeoutMs?: number;
  copy?: (text: string) => Promise<CopyResult>;
}

export function useCopy({ timeoutMs, copy = copyText }: UseCopyOptions = {}) {
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);

  const performCopy = useCallback(
    async (text: string): Promise<CopyResult> => {
      const res = await copy(text);
      setCopyResult(res);
      return res;
    },
    [copy]
  );

  useEffect(() => {
    if (timeoutMs === undefined || copyResult === null) {
      return undefined;
    }
    const timer = setTimeout(() => setCopyResult(null), timeoutMs);
    return () => clearTimeout(timer);
  }, [copyResult, timeoutMs]);

  return {
    copyResult,
    setCopyResult,
    copy: performCopy,
  };
}

export interface CopyNoticeProps extends HTMLAttributes<HTMLParagraphElement> {
  result: CopyResult | null;
  variant?: 'inline' | 'toast';
}

export function CopyNotice({ result, variant = 'inline', className, ...props }: CopyNoticeProps) {
  const { t } = useI18n();

  if (variant === 'toast') {
    return (
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={
          result === null
            ? 'sr-only'
            : cn(
                'pointer-events-none fixed bottom-8 left-1/2 z-40 -translate-x-1/2 rounded border border-border bg-raised px-3 py-1 text-xs text-foreground shadow',
                className
              )
        }
        {...props}
      >
        {result === null ? '' : t(result === 'copied' ? 'clipboard.copied' : 'clipboard.failed')}
      </p>
    );
  }

  if (result === null) {
    return null;
  }

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    >
      {t(result === 'copied' ? 'clipboard.copied' : 'clipboard.failed')}
    </p>
  );
}
