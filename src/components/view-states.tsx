import { useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, TriangleAlert } from 'lucide-react';

import type { Issue, SyncState } from '@/bindings/bd';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/ui/state-badge';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { cn } from '@/lib/utils';

export const HEALTHY: SyncState = { kind: 'healthy', lastSeq: 0, lastEventAt: null };

export function issuePath(projectId: string, issueId: string): string {
  return `/w/${projectId}/issue/${encodeURIComponent(issueId)}`;
}

export function useOpenIssue(projectId: string): (issue: Issue) => void {
  const navigate = useNavigate();
  return useCallback(
    (issue: Issue) => {
      navigate(issuePath(projectId, issue.id));
    },
    [navigate, projectId]
  );
}

export interface StateScreenProps {
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  tone?: 'muted' | 'danger';
  role?: string;
  className?: string;
  children?: ReactNode;
}

export function StateScreen({
  icon,
  title,
  body,
  tone,
  role,
  className,
  children,
}: StateScreenProps) {
  return (
    <div
      role={role}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center',
        className
      )}
    >
      <StateBadge tone={tone} icon={icon} />
      <p className={cn('text-sm font-medium', tone === 'danger' && 'text-destructive')}>{title}</p>
      {body !== undefined ? <p className="max-w-sm text-xs text-muted-foreground">{body}</p> : null}
      {children}
    </div>
  );
}

export interface EmptyStateProps {
  footer?: ReactNode;
}

export function EmptyState({ footer }: EmptyStateProps = {}) {
  const { t } = useI18n();
  return (
    <StateScreen
      icon={<Inbox aria-hidden="true" className="size-4" />}
      title={t('list.state.empty.title')}
      body={t('list.state.empty.body')}
    >
      {footer}
    </StateScreen>
  );
}

export interface ErrorStateProps {
  message: string;
  onRefresh?: () => void;
}

export function ErrorState({ message, onRefresh }: ErrorStateProps) {
  const { t } = useI18n();
  return (
    <StateScreen
      role="alert"
      tone="danger"
      icon={<TriangleAlert aria-hidden="true" className="size-4" />}
      title={t('list.state.error.title')}
    >
      <p className="text-xs text-muted-foreground">{t('list.state.error.body')}</p>
      <p className="max-w-md text-xs text-muted-foreground">{message}</p>
      {onRefresh === undefined ? null : (
        <Button size="md" variant="secondary" onClick={onRefresh} className="mt-1">
          {t('list.state.retry')}
        </Button>
      )}
    </StateScreen>
  );
}

export interface StaleBannerProps {
  onRefresh?: () => void;
}

export function StaleBanner({ onRefresh }: StaleBannerProps) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <span className="min-w-0 flex-1">{t('list.state.stale')}</span>
      {onRefresh === undefined ? null : (
        <Button
          size="xs"
          variant="secondary"
          onClick={onRefresh}
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          {t('list.state.retry')}
        </Button>
      )}
    </div>
  );
}
