import type { Issue } from '@/bindings/bd';

/**
 * The fields a person can edit on the detail page. Timestamps and counts are
 * deliberately absent: bd bumps them on every write, so comparing them cannot
 * tell "someone else edited" from "this page just saved".
 */
export const DRAFT_FIELDS = [
  'title',
  'description',
  'acceptance_criteria',
  'status',
  'priority',
  'assignee',
  'labels',
  'comments',
  'design',
  'notes',
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

/** Content fields that differ between two snapshots of the same ticket. */
export function changedFields(before: Issue, after: Issue): DraftField[] {
  return DRAFT_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])
  );
}

/**
 * `design` and `notes` are not first-class export fields; bd carries them in
 * the extra map. Only a non-empty string is rendered.
 */
export function textField(issue: Issue, key: 'design' | 'notes'): string | null {
  const value = issue[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

