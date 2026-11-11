import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Comment, Dependency, Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { MAX_ACCEPTANCE_BYTES } from '@/lib/writes/commands';
import type { UseWrite } from '@/lib/writes/useWrite';
import { fakeWrites } from '@/test/detail-writes';
import { makeIssue, renderWithI18n, TEST_TS as TS } from '@/test/fixtures';

import { DetailView } from './DetailView';

// The plugin cannot open a URL inside jsdom: every link click here is a
// failure path, which is what the feedback test needs.
vi.mock('@/lib/links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/links')>();
  return {
    ...actual,
    openExternal: vi.fn(async () => {
      throw new Error('no default browser');
    }),
  };
});

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return makeIssue(id, { description: `Description of ${id}`, ...overrides });
}

function edge(issueId: string, dependsOnId: string): Dependency {
  return { issue_id: issueId, depends_on_id: dependsOnId, type: 'blocks', created_at: TS };
}

function comment(id: string, text: string, createdAt: string): Comment {
  return { id, issue_id: 'b', author: 'ada', text, created_at: createdAt };
}

function renderDetail(target: Issue, issues: readonly Issue[] = [target], writes?: UseWrite) {
  const onBack = vi.fn();
  renderWithI18n(
    <DetailView issueId={target.id} issues={issues} onBack={onBack} writes={writes} />
  );
  return { onBack };
}

/** Pick a status from the rail's popover (its radios live inside `<details>`). */
function chooseStatus(option: RegExp) {
  const details = document.querySelector<HTMLDetailsElement>('details[aria-label="Status"]');
  if (details === null) {
    throw new Error('no Status menu');
  }
  details.open = true;
  fireEvent.click(within(details).getByRole('radio', { name: option }));
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

  const { unmount } = renderWithI18n(
    <DetailView issueId="bza-b" issues={[a, b, c]} onBack={vi.fn()} />
  );

  const blockedBy = screen.getByRole('region', { name: 'Blocked by' });
  expect(within(blockedBy).getByText('bza-a')).toBeInTheDocument();
  expect(within(blockedBy).getByText('bza-c')).toBeInTheDocument();
  unmount();

  renderDetail(a, [a, b, c]);

  const blocks = screen.getByRole('region', { name: 'Blocks' });
  expect(within(blocks).getByText('bza-b')).toBeInTheDocument();
});

test('a parent-child or related edge is not shown as a blocker', () => {
  const parent = issue('bza-a');
  const child = issue('bza-b', {
    dependencies: [
      { issue_id: 'bza-b', depends_on_id: 'bza-a', type: 'parent-child', created_at: TS },
      { issue_id: 'bza-b', depends_on_id: 'bza-c', type: 'related', created_at: TS },
    ],
  });

  renderDetail(child, [parent, child]);

  expect(screen.queryByRole('region', { name: 'Blocked by' })).toBeNull();
  expect(screen.getByText('No dependencies.')).toBeInTheDocument();
});

test('a dependency target outside the store is shown and marked not found', () => {
  const target = issue('bza-b', { dependencies: [edge('bza-b', 'bza-gone')] });

  renderDetail(target);

  const blockedBy = screen.getByRole('region', { name: 'Blocked by' });
  expect(within(blockedBy).getByText('bza-gone')).toBeInTheDocument();
  expect(within(blockedBy).getByText('Not found')).toBeInTheDocument();
});

test('an id that is no longer in the store shows a not-found state instead of crashing', () => {
  renderWithI18n(<DetailView issueId="bza-gone" issues={[issue('bza-b')]} onBack={vi.fn()} />);

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
  for (const summary of ['Design', 'Notes']) {
    const details = screen.getByText(summary).closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  }
});

test('the page follows the language setting', () => {
  renderWithI18n(
    <DetailView issueId="bza-b" issues={[issue('bza-b')]} onBack={vi.fn()} />,
    'zh-CN'
  );

  expect(screen.getByText('正文')).toBeInTheDocument();
  expect(screen.getByText('验收条件')).toBeInTheDocument();
  expect(screen.getByText('评论')).toBeInTheDocument();
});

test('a missing id while the baseline is loading is not reported as deleted', () => {
  renderWithI18n(<DetailView issueId="bza-gone" issues={[]} onBack={vi.fn()} loading />);

  expect(screen.getByRole('status')).toHaveTextContent('Loading ticket…');
  expect(screen.queryByRole('heading', { name: 'Ticket not found' })).toBeNull();
});

test('the back control calls the route callback', () => {
  const { onBack } = renderDetail(issue('bza-b'));

  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(onBack).toHaveBeenCalledTimes(1);
});

test('editing the title submits one update and closes the editor after success', async () => {
  const writes = fakeWrites();
  renderDetail(issue('bza-b', { title: 'Old title' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'New title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull());

  const submission = vi.mocked(writes.submit).mock.calls[0][0];
  expect(submission.issueId).toBe('bza-b');
  expect(submission.build()).toMatchObject({ Update: { id: 'bza-b', title: 'New title' } });
});

test('an empty title is rejected locally without a bd call', () => {
  const writes = fakeWrites();
  renderDetail(issue('bza-b', { title: 'Old title' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: '   ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(screen.getByRole('alert')).toHaveTextContent('The title cannot be empty.');
  expect(writes.submit).not.toHaveBeenCalled();
});

test('a failed save keeps the title editor and its draft', async () => {
  const writes = fakeWrites({
    submit: vi.fn(async () => ({
      status: 'failed' as const,
      error: { code: 'BD_TIMEOUT' as const, message: 'bd timed out' },
    })),
  });
  renderDetail(issue('bza-b', { title: 'Old title' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Draft title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Draft title');
});

test('the body and acceptance editors submit their own fields', async () => {
  const writes = fakeWrites();
  renderDetail(
    issue('bza-b', { description: 'Old body', acceptance_criteria: 'Old acceptance' }),
    undefined,
    writes
  );

  const description = screen.getByRole('region', { name: 'Description' });
  fireEvent.click(within(description).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
    target: { value: 'New body' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull());
  expect(vi.mocked(writes.submit).mock.calls[0][0].build()).toMatchObject({
    Update: { description: 'New body' },
  });

  const acceptance = screen.getByRole('region', { name: 'Acceptance criteria' });
  fireEvent.click(within(acceptance).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Acceptance criteria' }), {
    target: { value: 'New acceptance' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(2));
  expect(vi.mocked(writes.submit).mock.calls[1][0].build()).toMatchObject({
    Update: { acceptance: 'New acceptance' },
  });
});

test('a comment submits through the write controller', async () => {
  const writes = fakeWrites();
  renderDetail(issue('bza-b'), undefined, writes);

  fireEvent.change(screen.getByRole('textbox', { name: 'Write a comment…' }), {
    target: { value: 'Nice work' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(writes.submit).mock.calls[0][0].build()).toEqual({
    Comment: { id: 'bza-b', text: 'Nice work' },
  });
});

test('without a write controller the reading page stays read-only', () => {
  renderDetail(issue('bza-b'));

  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});

test('a deleted ticket shows a banner and closes after three seconds', () => {
  vi.useFakeTimers();
  const onBack = vi.fn();
  const target = issue('bza-b');
  const { rerender } = render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-b" issues={[target]} onBack={onBack} />
    </I18nProvider>
  );

  rerender(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-b" issues={[]} onBack={onBack} />
    </I18nProvider>
  );

  expect(screen.getByRole('status')).toHaveTextContent('This ticket was deleted.');

  act(() => {
    vi.advanceTimersByTime(3_000);
  });

  expect(onBack).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test('an update from elsewhere is announced without overwriting the draft', () => {
  const writes = fakeWrites();
  const target = issue('bza-b', { title: 'Old title' });
  const { rerender } = render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-b" issues={[target]} onBack={vi.fn()} writes={writes} />
    </I18nProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Draft title' },
  });

  rerender(
    <I18nProvider initialLanguage="en">
      <DetailView
        issueId="bza-b"
        issues={[
          issue('bza-b', { title: 'Changed elsewhere', updated_at: '2026-11-02T00:00:00Z' }),
        ]}
        onBack={vi.fn()}
        writes={writes}
      />
    </I18nProvider>
  );

  expect(screen.getByText(/Updated elsewhere/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Draft title');
});

test('detail single-key shortcuts open editors and focus controls', () => {
  renderDetail(issue('bza-b'), undefined, fakeWrites());

  fireEvent.keyDown(window, { key: 'e' });
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'a' });
  expect(screen.queryByRole('textbox', { name: 'Acceptance criteria' })).toBeNull();

  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Escape' });
  fireEvent.keyDown(window, { key: 'a' });
  expect(screen.getByRole('textbox', { name: 'Acceptance criteria' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Acceptance criteria' }), {
    key: 'Escape',
  });

  fireEvent.keyDown(window, { key: 'c' });
  expect(screen.getByRole('textbox', { name: 'Write a comment…' })).toHaveFocus();

  fireEvent.keyDown(window, { key: 's' });
  expect(document.getElementById('detail-status')).toHaveFocus();

  fireEvent.keyDown(window, { key: 'p' });
  expect(document.getElementById('detail-priority')).toHaveFocus();
});

test('single-key shortcuts stay out of a focused metadata dropdown', () => {
  renderDetail(issue('bza-b'), undefined, fakeWrites());
  const status = document.getElementById('detail-status');
  if (status === null) {
    throw new Error('no status trigger');
  }

  // A summary now owns the keys a native select used to; `e` must not jump
  // into the title editor while the dropdown trigger has focus.
  status.focus();
  fireEvent.keyDown(status, { key: 'e' });

  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
});
test('a saved title stays old until the journal echo updates the store', async () => {
  const writes = fakeWrites();
  const target = issue('bza-b', { title: 'Old title' });
  const { rerender } = render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-b" issues={[target]} onBack={vi.fn()} writes={writes} />
    </I18nProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'New title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull());
  expect(screen.getByRole('heading', { level: 1, name: 'Old title' })).toBeInTheDocument();

  rerender(
    <I18nProvider initialLanguage="en">
      <DetailView
        issueId="bza-b"
        issues={[issue('bza-b', { title: 'New title', updated_at: '2026-11-02T00:00:00Z' })]}
        onBack={vi.fn()}
        writes={writes}
      />
    </I18nProvider>
  );

  expect(screen.getByRole('heading', { level: 1, name: 'New title' })).toBeInTheDocument();
});

test('leaving with an open draft asks before discarding it', () => {
  const writes = fakeWrites();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onBack } = renderDetail(issue('bza-b', { title: 'Old title' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Draft title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(confirm).toHaveBeenCalledWith('Discard the unsaved draft?');
  expect(onBack).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(onBack).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

test('escape outside the input cancels the draft instead of leaving the page', () => {
  const { onBack } = renderDetail(issue('bza-b'), undefined, fakeWrites());

  fireEvent.keyDown(window, { key: 'e' });
  expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'Escape' });

  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
  expect(onBack).not.toHaveBeenCalled();
});

test('an open modal owns Escape, so the draft behind it survives', () => {
  const writes = fakeWrites();
  renderDetail(issue('bza-b', { title: 'Old title' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Draft title' },
  });

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const close = vi.fn();
  dialog.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      close();
    }
  });
  document.body.append(dialog);

  try {
    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Draft title');
  } finally {
    dialog.remove();
  }

  // Without the modal, the same key falls back to cancelling the draft.
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
});

test('a comment draft asks before the page is left', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const writes = fakeWrites();
  const { onBack } = renderDetail(issue('bza-b'), undefined, writes);

  fireEvent.change(screen.getByRole('textbox', { name: 'Write a comment…' }), {
    target: { value: 'Half a thought' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(confirm).toHaveBeenCalledWith('Discard the unsaved draft?');
  expect(onBack).not.toHaveBeenCalled();

  confirm.mockRestore();
});

test('an empty comment composer does not block navigation', () => {
  const confirm = vi.spyOn(window, 'confirm');
  const { onBack } = renderDetail(issue('bza-b'), undefined, fakeWrites());

  fireEvent.change(screen.getByRole('textbox', { name: 'Write a comment…' }), {
    target: { value: '   ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(confirm).not.toHaveBeenCalled();
  expect(onBack).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

test('an unchanged assignee editor does not block navigation', () => {
  const confirm = vi.spyOn(window, 'confirm');
  const { onBack } = renderDetail(issue('bza-b'), undefined, fakeWrites());

  fireEvent.click(screen.getByRole('button', { name: 'Edit assignee' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(confirm).not.toHaveBeenCalled();
  expect(onBack).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

test('the assignee editor asks before the page is left once its draft differs', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onBack } = renderDetail(issue('bza-b'), undefined, fakeWrites());

  fireEvent.click(screen.getByRole('button', { name: 'Edit assignee' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Assignee' }), {
    target: { value: 'ada' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(confirm).toHaveBeenCalledWith('Discard the unsaved draft?');
  expect(onBack).not.toHaveBeenCalled();

  confirm.mockRestore();
});

test('a half-typed label asks before the page is left', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { onBack } = renderDetail(issue('bza-b'), undefined, fakeWrites());

  fireEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'New label' }), {
    target: { value: 'ui' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(confirm).toHaveBeenCalledWith('Discard the unsaved draft?');
  expect(onBack).not.toHaveBeenCalled();

  confirm.mockRestore();
});

test('a failed comment shows the error and keeps the text', async () => {
  const writes = fakeWrites({
    submit: vi.fn(async () => ({
      status: 'failed' as const,
      error: { code: 'BD_TIMEOUT' as const, message: 'bd hung' },
    })),
  });
  renderDetail(issue('bza-b'), undefined, writes);

  const composer = screen.getByRole('textbox', { name: 'Write a comment…' });
  fireEvent.change(composer, { target: { value: 'Do not lose me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Saving timed out');
  expect(composer).toHaveValue('Do not lose me');
  expect(screen.getByRole('button', { name: 'Comment' })).toBeEnabled();
});

test('an acceptance draft over the 16 KiB limit is rejected before any write', () => {
  const writes = fakeWrites();
  const tooLong = 'x'.repeat(MAX_ACCEPTANCE_BYTES + 1);
  renderDetail(issue('bza-b', { acceptance_criteria: 'Old acceptance' }), undefined, writes);

  const acceptance = screen.getByRole('region', { name: 'Acceptance criteria' });
  fireEvent.click(within(acceptance).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Acceptance criteria' }), {
    target: { value: tooLong },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(screen.getByRole('alert')).toHaveTextContent(`${MAX_ACCEPTANCE_BYTES} bytes`);
  expect(writes.submit).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Acceptance criteria' })).toHaveValue(tooLong);
});

test('an acceptance draft exactly at the limit is submitted', async () => {
  const writes = fakeWrites();
  renderDetail(issue('bza-b', { acceptance_criteria: 'Old acceptance' }), undefined, writes);

  const acceptance = screen.getByRole('region', { name: 'Acceptance criteria' });
  fireEvent.click(within(acceptance).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Acceptance criteria' }), {
    target: { value: 'x'.repeat(MAX_ACCEPTANCE_BYTES) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a write from this page does not claim the ticket changed elsewhere', () => {
  const writes = fakeWrites();
  const target = issue('bza-b', { title: 'Old title' });
  const { rerender } = render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-b" issues={[target]} onBack={vi.fn()} writes={writes} />
    </I18nProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  chooseStatus(/In progress/);

  // The journal echo of that status write reaches the store.
  rerender(
    <I18nProvider initialLanguage="en">
      <DetailView
        issueId="bza-b"
        issues={[
          issue('bza-b', {
            title: 'Old title',
            status: 'in_progress',
            updated_at: '2026-11-02T00:00:00Z',
          }),
        ]}
        onBack={vi.fn()}
        writes={writes}
      />
    </I18nProvider>
  );

  expect(screen.queryByText(/Updated elsewhere/)).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Old title');
});

test('an outside edit is still announced after a write from this page', () => {
  const writes = fakeWrites();
  const target = issue('bza-b', { title: 'Old title' });
  const { rerender } = render(
    <I18nProvider initialLanguage="en">
      <DetailView issueId="bza-b" issues={[target]} onBack={vi.fn()} writes={writes} />
    </I18nProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  chooseStatus(/In progress/);
  rerender(
    <I18nProvider initialLanguage="en">
      <DetailView
        issueId="bza-b"
        issues={[
          issue('bza-b', {
            title: 'Old title',
            status: 'in_progress',
            updated_at: '2026-11-02T00:00:00Z',
          }),
        ]}
        onBack={vi.fn()}
        writes={writes}
      />
    </I18nProvider>
  );
  expect(screen.queryByText(/Updated elsewhere/)).toBeNull();

  rerender(
    <I18nProvider initialLanguage="en">
      <DetailView
        issueId="bza-b"
        issues={[
          issue('bza-b', {
            title: 'Changed elsewhere',
            status: 'in_progress',
            updated_at: '2026-11-02T01:00:00Z',
          }),
        ]}
        onBack={vi.fn()}
        writes={writes}
      />
    </I18nProvider>
  );

  expect(screen.getByText(/Updated elsewhere/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Old title');
});

test('a link the system refuses to open says so instead of failing silently', async () => {
  renderDetail(issue('bza-b', { description: 'See [the docs](https://example.com/docs).' }));

  fireEvent.click(screen.getByRole('link', { name: 'the docs' }));

  expect(
    await screen.findByText('The link could not be opened in your browser.')
  ).toBeInTheDocument();
});

test('a write that misses its echo says the view was refreshed', async () => {
  const writes = fakeWrites({
    submit: vi.fn(async () => ({ status: 'ok' as const, echo: 'timeout' as const })),
  });
  renderDetail(issue('bza-b', { title: 'Old title' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Old title' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'New title' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText(/the view did not confirm in time/)).toBeInTheDocument();
});
