import { expect, test } from 'vitest';

import type { Issue } from '@/bindings/bd';
import { makeIssue } from '@/test/fixtures';

import { changedFields, textField } from './changes';

function issue(overrides: Partial<Issue> = {}): Issue {
  return makeIssue('bza-b', { title: 'Ticket', description: 'Body', ...overrides });
}

test('a timestamp-only update is not a content change', () => {
  expect(changedFields(issue(), issue({ updated_at: '2026-11-02T00:00:00Z' }))).toEqual([]);
  expect(changedFields(issue(), issue({ comment_count: 3 }))).toEqual([]);
});

test('each edited field is reported by name', () => {
  expect(changedFields(issue(), issue({ title: 'Renamed' }))).toEqual(['title']);
  expect(changedFields(issue(), issue({ status: 'closed' }))).toEqual(['status']);
  expect(changedFields(issue(), issue({ labels: ['ui'] }))).toEqual(['labels']);
  expect(changedFields(issue(), issue({ acceptance_criteria: 'shipped' }))).toEqual([
    'acceptance_criteria',
  ]);
});

test('several edits come back in field order', () => {
  const after = issue({ status: 'in_progress', title: 'Renamed', priority: 1 });

  expect(changedFields(issue(), after)).toEqual(['title', 'status', 'priority']);
});

test('an explicit empty value differs from a missing one', () => {
  expect(changedFields(issue(), issue({ assignee: 'ada' }))).toEqual(['assignee']);
  expect(changedFields(issue({ assignee: 'ada' }), issue())).toEqual(['assignee']);
});

test('textField extracts non-empty string and ignores missing or whitespace values', () => {
  expect(textField(issue({ design: 'Architecture diagram' }), 'design')).toBe(
    'Architecture diagram'
  );
  expect(textField(issue({ notes: 'Note text' }), 'notes')).toBe('Note text');
  expect(textField(issue(), 'design')).toBeNull();
  expect(textField(issue({ design: '' }), 'design')).toBeNull();
  expect(textField(issue({ design: '   ' }), 'design')).toBeNull();
});
