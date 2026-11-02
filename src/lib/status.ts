import type { MessageKey } from '@/lib/i18n';

/** Canonical display order from SPEC-list; unknown statuses follow it. */
export const STATUS_ORDER = [
  'open',
  'in_progress',
  'blocked',
  'deferred',
  'closed',
  'pinned',
  'hooked',
];

export const STATUS_ICONS: Record<string, string> = {
  open: '○',
  in_progress: '◐',
  blocked: '⊘',
  deferred: '❄',
  closed: '✓',
  pinned: '⌖',
  hooked: '↪',
};

const STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  open: 'list.status.open',
  in_progress: 'list.status.in_progress',
  blocked: 'list.status.blocked',
  deferred: 'list.status.deferred',
  closed: 'list.status.closed',
  pinned: 'list.status.pinned',
  hooked: 'list.status.hooked',
};

/** Known statuses translate; a status from a newer bd shows its raw value. */
export function statusText(status: string, t: (key: MessageKey) => string): string {
  const key = STATUS_LABEL_KEYS[status];
  return key === undefined ? status : t(key);
}
