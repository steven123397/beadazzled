import type { AssigneeChange, CreateSpec, UpdateSpec, WriteCommand } from '@/bindings/bd';

// `bd --acceptance` only has an argv channel; keep well below the Windows
// CreateProcessW limit so a long acceptance fails visibly here instead of
// failing the spawn.
export const MAX_ACCEPTANCE_BYTES = 16 * 1024;

export type WriteValidationCode =
  'ACCEPTANCE_TOO_LONG' | 'LABEL_CONTAINS_COMMA' | 'PRIORITY_OUT_OF_RANGE' | 'EMPTY_UPDATE';

export type WriteValidationError = {
  code: WriteValidationCode;
  message: string;
};

export type CommandResult =
  { ok: true; command: WriteCommand } | { ok: false; error: WriteValidationError };

export type AssigneeEdit = { set: string } | { clear: true };

export type CreateInput = {
  title: string;
  description?: string;
  issueType?: string;
  priority?: number;
  labels?: string[];
  acceptance?: string | null;
  assignee?: string | null;
};

export type UpdateInput = {
  status?: string | null;
  priority?: number | null;
  assignee?: AssigneeEdit | null;
  title?: string | null;
  description?: string | null;
  acceptance?: string | null;
  addLabels?: string[];
  removeLabels?: string[];
  ifStatus?: string | null;
  ifAssignee?: string | null;
};

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function rejection(code: WriteValidationCode, message: string): CommandResult {
  return { ok: false, error: { code, message } };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validateAcceptance(acceptance: string | null | undefined): CommandResult | null {
  if (isNil(acceptance)) {
    return null;
  }
  if (byteLength(acceptance) > MAX_ACCEPTANCE_BYTES) {
    return rejection(
      'ACCEPTANCE_TOO_LONG',
      `Acceptance criteria must stay under ${MAX_ACCEPTANCE_BYTES} bytes of UTF-8 text.`
    );
  }
  return null;
}

function validatePriority(priority: number | null | undefined): CommandResult | null {
  if (isNil(priority)) {
    return null;
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    return rejection('PRIORITY_OUT_OF_RANGE', 'Priority must be an integer from 0 to 4.');
  }
  return null;
}

function validateLabels(labels: readonly string[]): CommandResult | null {
  if (labels.some((label) => label.includes(','))) {
    return rejection(
      'LABEL_CONTAINS_COMMA',
      'Labels cannot contain commas: bd splits --labels on commas.'
    );
  }
  return null;
}

function assigneeChange(edit: AssigneeEdit): AssigneeChange {
  return 'set' in edit ? { Set: edit.set } : 'Clear';
}

export function createIssue(input: CreateInput): CommandResult {
  const invalid =
    validateAcceptance(input.acceptance) ??
    validatePriority(input.priority) ??
    validateLabels(input.labels ?? []);
  if (invalid) {
    return invalid;
  }

  const spec: CreateSpec = {
    title: input.title,
    description: input.description ?? '',
    issue_type: input.issueType ?? 'task',
    priority: input.priority ?? 2,
    labels: input.labels ?? [],
    acceptance: input.acceptance ?? null,
    assignee: input.assignee ?? null,
  };
  return { ok: true, command: { Create: spec } };
}

export function updateIssue(id: string, input: UpdateInput): CommandResult {
  const addition = input.addLabels ?? [];
  const removal = input.removeLabels ?? [];
  const invalid =
    validateAcceptance(input.acceptance) ??
    validatePriority(input.priority) ??
    validateLabels(addition) ??
    validateLabels(removal);
  if (invalid) {
    return invalid;
  }

  const changed =
    !isNil(input.status) ||
    !isNil(input.priority) ||
    !isNil(input.assignee) ||
    !isNil(input.title) ||
    !isNil(input.description) ||
    !isNil(input.acceptance) ||
    addition.length > 0 ||
    removal.length > 0;
  if (!changed) {
    return rejection('EMPTY_UPDATE', 'This update does not change any field.');
  }

  const spec: UpdateSpec = {
    id,
    status: input.status ?? null,
    priority: input.priority ?? null,
    assignee: isNil(input.assignee) ? null : assigneeChange(input.assignee),
    title: input.title ?? null,
    description: input.description ?? null,
    acceptance: input.acceptance ?? null,
    add_labels: addition,
    remove_labels: removal,
    if_status: input.ifStatus ?? null,
    if_assignee: input.ifAssignee ?? null,
  };
  return { ok: true, command: { Update: spec } };
}

export function closeIssue(id: string, reason?: string | null): WriteCommand {
  return { Close: { id, reason: reason ?? null } };
}

export function reopenIssue(id: string): WriteCommand {
  return { Reopen: { id } };
}

export function commentIssue(id: string, text: string): WriteCommand {
  return { Comment: { id, text } };
}
