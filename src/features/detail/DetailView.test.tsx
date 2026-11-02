import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Comment, Dependency, Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';

import { DetailView } from './DetailView';

const TS = '2026-11-01T00:00:00Z';

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: `Description of ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: TS,
    updated_at: TS,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function edge(issueId: string, dependsOnId: string): Dependency {
  return { issue_id: issueId, depends_on_id: dependsOnId, type: 'blocks', created_at: TS };
}

function comment(id: string, text: string, createdAt: string): Comment {
  return { id, issue_id: 'b', author: 'ada', text, created_at: createdAt };
}

function renderDetail(target: Issue, issues: readonly Issue[] = [target]) {
  const onBack = vi.fn();
  render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId={target.id} issues={issues} onBack={onBack} />
    </I18nProvider>
  );
  return { onBack };
}

test('the page shows title, markdown body, acceptance, metadata and comments', () => {
  const target = issue('bza-b', {
    title: 'Document reading',
    description: 'Some **bold** body',
    acceptance_criteria: '- [x] shipped',
    assignee: 'ada',
    labels: ['ui'],
    comments: [comment('c1', 'First thought', TS)],
    comment_count: 1,
  });

  renderDetail(target);

  expect(screen.getByRole('heading', { level: 1, name: 'Document reading' })).toBeInTheDocument();
  expect(screen.getByText('Some', { exact: false })).toContainHTML('<strong>bold</strong>');
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(screen.getByText('bza-b')).toBeInTheDocument();
  expect(screen.getAllByText('Open')).toHaveLength(2);
  expect(screen.getAllByText('P2')).toHaveLength(2);
  expect(screen.getAllByText('ada')).toHaveLength(2);
  expect(screen.getByText('ui')).toBeInTheDocument();
  expect(screen.getByText('First thought')).toBeInTheDocument();
});

test('comments are listed oldest first even when the payload is unordered', () => {
  const target = issue('bza-b', {
    comments: [
      comment('c2', 'Second', '2026-11-01T02:00:00Z'),
      comment('c1', 'First', '2026-11-01T01:00:00Z'),
    ],
  });

  renderDetail(target);

  const items = within(screen.getByRole('list', { name: 'Comments' })).getAllByRole('listitem');
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining('First'),
    expect.stringContaining('Second'),
  ]);
});

test('blocked by and blocks both resolve from the dependency edges', () => {
  const a = issue('bza-a');
  const b = issue('bza-b', { dependencies: [edge('bza-b', 'bza-a'), edge('bza-b', 'bza-c')] });
  const c = issue('bza-c');

  const { unmount } = render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-b" issues={[a, b, c]} onBack={vi.fn()} />
    </I18nProvider>
  );

  const blockedBy = screen.getByRole('region', { name: 'Blocked by' });
  expect(within(blockedBy).getByText('bza-a')).toBeInTheDocument();
  expect(within(blockedBy).getByText('bza-c')).toBeInTheDocument();
  unmount();

  renderDetail(a, [a, b, c]);

  const blocks = screen.getByRole('region', { name: 'Blocks' });
  expect(within(blocks).getByText('bza-b')).toBeInTheDocument();
});

test('a dependency target outside the store is shown and marked not found', () => {
  const target = issue('bza-b', { dependencies: [edge('bza-b', 'bza-gone')] });

  renderDetail(target);

  const blockedBy = screen.getByRole('region', { name: 'Blocked by' });
  expect(within(blockedBy).getByText('bza-gone')).toBeInTheDocument();
  expect(within(blockedBy).getByText('Not found')).toBeInTheDocument();
});

test('an id that is no longer in the store shows a not-found state instead of crashing', () => {
  render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-gone" issues={[issue('bza-b')]} onBack={vi.fn()} />
    </I18nProvider>
  );

  expect(screen.getByRole('heading', { name: 'Ticket not found' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to list' })).toBeInTheDocument();
});

test('empty description, acceptance and comments use muted placeholders', () => {
  renderDetail(issue('bza-b', { description: '', acceptance_criteria: undefined }));

  expect(screen.getByText('No description yet.')).toBeInTheDocument();
  expect(screen.getByText('No acceptance criteria yet.')).toBeInTheDocument();
  expect(screen.getByText('No comments yet.')).toBeInTheDocument();
});

test('design and notes are folded away when present', () => {
  const target = issue('bza-b', { design: 'Design body', notes: 'Note body' });

  renderDetail(target);

  expect(screen.getByText('Design')).toBeInTheDocument();
  expect(screen.getByText('Design body')).toBeInTheDocument();
  expect(screen.getByText('Note body')).toBeInTheDocument();
});

test('a missing id while the baseline is loading is not reported as deleted', () => {
  render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-gone" issues={[]} onBack={vi.fn()} loading />
    </I18nProvider>
  );

  expect(screen.getByRole('status')).toHaveTextContent('Loading ticket…');
  expect(screen.queryByRole('heading', { name: 'Ticket not found' })).toBeNull();
});

test('the back control calls the route callback', () => {
  const { onBack } = renderDetail(issue('bza-b'));

  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(onBack).toHaveBeenCalledTimes(1);
});