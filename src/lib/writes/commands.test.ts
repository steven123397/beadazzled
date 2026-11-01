import { expect, test } from 'vitest';

import type { WriteCommand } from '@/bindings/bd';

import {
  MAX_ACCEPTANCE_BYTES,
  closeIssue,
  commentIssue,
  createIssue,
  reopenIssue,
  updateIssue,
} from './commands';

function commandOf(result: ReturnType<typeof createIssue>): WriteCommand {
  if (!result.ok) {
    throw new Error(`expected a command, got validation error ${result.error.code}`);
  }
  return result.command;
}

function create(input: Parameters<typeof createIssue>[0]): WriteCommand {
  return commandOf(createIssue(input));
}

test('create maps every field and defaults type and priority', () => {
  const command = create({
    title: 'Fix the list',
    description: 'Steps to reproduce\nwith newlines',
    labels: ['ui', 'bug'],
    acceptance: 'List scrolls at 60fps',
    assignee: 'steven',
  });

  expect(command).toEqual({
    Create: {
      title: 'Fix the list',
      description: 'Steps to reproduce\nwith newlines',
      issue_type: 'task',
      priority: 2,
      labels: ['ui', 'bug'],
      acceptance: 'List scrolls at 60fps',
      assignee: 'steven',
    },
  });
});

test('create keeps an empty description and null optionals', () => {
  expect(create({ title: 'Only a title' })).toEqual({
    Create: {
      title: 'Only a title',
      description: '',
      issue_type: 'task',
      priority: 2,
      labels: [],
      acceptance: null,
      assignee: null,
    },
  });
});

test('update merges status, priority and labels into one command', () => {
  const result = updateIssue('bza-1', {
    status: 'in_progress',
    priority: 1,
    addLabels: ['backend'],
    removeLabels: ['frontend'],
  });

  expect(commandOf(result)).toEqual({
    Update: {
      id: 'bza-1',
      status: 'in_progress',
      priority: 1,
      assignee: null,
      title: null,
      description: null,
      acceptance: null,
      add_labels: ['backend'],
      remove_labels: ['frontend'],
      if_status: null,
      if_assignee: null,
    },
  });
});

test('update maps assignee set and clear', () => {
  expect(commandOf(updateIssue('bza-1', { assignee: { set: 'ada' } }))).toMatchObject({
    Update: { assignee: { Set: 'ada' } },
  });
  expect(commandOf(updateIssue('bza-1', { assignee: { clear: true } }))).toMatchObject({
    Update: { assignee: 'Clear' },
  });
});

test('update carries the conflict guards used by board drags', () => {
  expect(
    commandOf(updateIssue('bza-1', { status: 'closed', ifStatus: 'in_progress' }))
  ).toMatchObject({ Update: { if_status: 'in_progress' } });

  expect(commandOf(updateIssue('bza-1', { assignee: { set: 'ada' }, ifAssignee: '' })))
    .toMatchObject({ Update: { if_assignee: '' } });
});

test('update rejects an action with no field changes', () => {
  const result = updateIssue('bza-1', {});

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('EMPTY_UPDATE');
  }
});

test('acceptance at the byte limit is allowed', () => {
  const acceptance = 'a'.repeat(MAX_ACCEPTANCE_BYTES);

  expect(create({ title: 'Limit', acceptance })).toMatchObject({
    Create: { acceptance },
  });
});

test('acceptance one byte over the limit is rejected', () => {
  const acceptance = 'a'.repeat(MAX_ACCEPTANCE_BYTES + 1);
  const result = createIssue({ title: 'Too long', acceptance });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe('ACCEPTANCE_TOO_LONG');
  }
});

test('acceptance length is measured in UTF-8 bytes', () => {
  const fits = '中'.repeat(5461); // 16_383 bytes
  const tooLong = '中'.repeat(5462); // 16_386 bytes

  expect(createIssue({ title: 'fits', acceptance: fits }).ok).toBe(true);
  expect(createIssue({ title: 'too long', acceptance: tooLong }).ok).toBe(false);
});

test('labels containing a comma are rejected on create and update', () => {
  const created = createIssue({ title: 'x', labels: ['ok', 'not,ok'] });
  const updated = updateIssue('bza-1', { addLabels: ['not,ok'] });

  expect(created.ok).toBe(false);
  expect(updated.ok).toBe(false);
  if (!created.ok) expect(created.error.code).toBe('LABEL_CONTAINS_COMMA');
  if (!updated.ok) expect(updated.error.code).toBe('LABEL_CONTAINS_COMMA');
});

test('priority outside 0-4 is rejected', () => {
  expect(createIssue({ title: 'x', priority: 5 }).ok).toBe(false);
  expect(createIssue({ title: 'x', priority: -1 }).ok).toBe(false);
  expect(updateIssue('bza-1', { priority: 9 }).ok).toBe(false);
});

test('close, reopen and comment build the matching commands', () => {
  expect(closeIssue('bza-1')).toEqual({ Close: { id: 'bza-1', reason: null } });
  expect(closeIssue('bza-1', 'done')).toEqual({
    Close: { id: 'bza-1', reason: 'done' },
  });
  expect(reopenIssue('bza-1')).toEqual({ Reopen: { id: 'bza-1' } });
  expect(commentIssue('bza-1', 'Looks good')).toEqual({
    Comment: { id: 'bza-1', text: 'Looks good' },
  });
});