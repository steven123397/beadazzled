import type { Issue } from '@/bindings/bd';

export const TEST_TS = '2026-11-01T00:00:00Z';

export function makeIssue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: TEST_TS,
    updated_at: TEST_TS,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}
