import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { listPath } from '@/app/paths';
import type { Issue } from '@/bindings/bd';
import { confirmLeaveDraft } from '@/lib/draft-guard';
import type { UseWrite } from '@/lib/writes/useWrite';

import { DetailView } from './DetailView';

export type DetailRouteProps = {
  issues: readonly Issue[];
  loading?: boolean;
  writes?: UseWrite;
};

/** Read the route params and remount the view when the ticket changes. */
export function DetailRoute({
  issues,
  loading,
  writes,
}: DetailRouteProps) {
  const { projectId = '', issueId = '' } = useParams<{ projectId: string; issueId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const back = useCallback(() => {
    // A deep link has no list entry to return to; a normal open should restore
    // the previous URL, which still carries the list filters.
    if (location.key === 'default') {
      navigate(listPath(projectId), { replace: true });
      return;
    }
    navigate(-1);
  }, [location.key, navigate, projectId]);

  const openIssue = useCallback(
    (id: string) => {
      if (!confirmLeaveDraft()) {
        return;
      }
      navigate(`/w/${projectId}/issue/${encodeURIComponent(id)}`);
    },
    [navigate, projectId]
  );

  return (
    <DetailView
      key={issueId}
      issueId={issueId}
      issues={issues}
      onBack={back}
      onOpenIssue={openIssue}
      loading={loading}
      writes={writes}
    />
  );
}
