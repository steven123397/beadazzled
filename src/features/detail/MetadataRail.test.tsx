import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Dependency, Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { indexIssues } from '@/lib/store/selectors';
import type { UseWrite } from '@/lib/writes/useWrite';

import { fakeWrites } from '@/test/detail-writes';
import { MetadataRail } from './MetadataRail';

const TS = '2026-11-01T00:00:00Z';

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: '',
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

function blockerEdge(dependsOnId: string): Dependency {
  return { issue_id: 'bza-b', depends_on_id: dependsOnId, type: 'blocks', created_at: TS };
}

function renderRail(target: Issue, issues: readonly Issue[] = [target], writes?: UseWrite) {
  render(
    <I18nProvider initialLanguage="en">
      <MetadataRail issue={target} index={indexIssues(issues)} writes={writes} />
    </I18nProvider>
  );
}

function submitted(writes: UseWrite) {
  return vi.mocked(writes.submit).mock.calls.map(([submission]) => submission.build());
}

test('a blocked target is disabled in the status menu and refuses to submit', () => {
  const blocker = issue('bza-a');
  const target = issue('bza-b', { dependencies: [blockerEdge('bza-a')] });
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(target, [target, blocker], writes);

  const status = screen.getByRole('combobox', { name: 'Status' });
  expect(within(status).getByRole('option', { name: /In progress/ })).toBeDisabled();
  expect(within(status).getByRole('option', { name: /Closed/ })).toBeDisabled();
  expect(within(status).getByRole('option', { name: /Blocked/ })).toBeEnabled();

  fireEvent.change(status, { target: { value: 'in_progress' } });

  expect(screen.getByRole('alert')).toHaveTextContent('bza-a');
  expect(writes.submit).not.toHaveBeenCalled();
});

test('an unblocked status change carries the expected-status guard', async () => {
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(issue('bza-b'), undefined, writes);

  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
    target: { value: 'in_progress' },
  });

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(submitted(writes)[0]).toMatchObject({
    Update: { status: 'in_progress', if_status: 'open' },
  });
});

test('a cleared blocker allows the same status change', () => {
  const blocker = issue('bza-a', { status: 'closed' });
  const target = issue('bza-b', { dependencies: [blockerEdge('bza-a')] });
  renderRail(target, [target, blocker], fakeWrites());

  expect(
    within(screen.getByRole('combobox', { name: 'Status' })).getByRole('option', {
      name: /In progress/,
    })
  ).toBeEnabled();
});

test('a target outside the store still counts as an unresolved blocker', () => {
  const target = issue('bza-b', { dependencies: [blockerEdge('bza-gone')] });
  renderRail(target, [target], fakeWrites());

  expect(
    within(screen.getByRole('combobox', { name: 'Status' })).getByRole('option', {
      name: /Closed/,
    })
  ).toBeDisabled();
});

test('priority changes submit with the current status guard', async () => {
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(issue('bza-b', { status: 'in_progress' }), undefined, writes);

  fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
    target: { value: '1' },
  });

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(submitted(writes)[0]).toMatchObject({
    Update: { priority: 1, if_status: 'in_progress' },
  });
});

test('assignee edits set and clear with the expected-assignee guard', async () => {
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(issue('bza-b', { assignee: 'ada' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Edit assignee' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Assignee' }), {
    target: { value: 'lin' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Assignee' })).toBeNull()
  );
  expect(submitted(writes)[0]).toMatchObject({
    Update: { assignee: { Set: 'lin' }, if_assignee: 'ada' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Edit assignee' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Assignee' }), {
    target: { value: '  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(2));
  expect(submitted(writes)[1]).toMatchObject({
    Update: { assignee: 'Clear', if_assignee: 'ada' },
  });
});

test('labels can be added and removed', async () => {
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(issue('bza-b', { labels: ['ui'] }), undefined, writes);

  fireEvent.change(screen.getByRole('textbox', { name: 'New label' }), {
    target: { value: 'backend' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(submitted(writes)[0]).toMatchObject({ Update: { add_labels: ['backend'] } });

  fireEvent.click(screen.getByRole('button', { name: 'Remove label ui' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(2));
  expect(submitted(writes)[1]).toMatchObject({ Update: { remove_labels: ['ui'] } });
});

test('close is refused while a blocker is unresolved and reopen appears once closed', () => {
  const blocker = issue('bza-a');
  const open = issue('bza-b', { dependencies: [blockerEdge('bza-a')] });
  renderRail(open, [open, blocker], fakeWrites());

  expect(screen.getByRole('button', { name: 'Close ticket' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Reopen ticket' })).toBeNull();
});

test('reopen submits the reopen command for a closed ticket', async () => {
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(issue('bza-b', { status: 'closed' }), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Reopen ticket' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(submitted(writes)[0]).toEqual({ Reopen: { id: 'bza-b' } });
});

test('pending writes disable every metadata control', () => {
  const writes = fakeWrites({ isPending: () => true, pending: ['bza-b'] });
  renderRail(issue('bza-b', { assignee: 'ada', labels: ['ui'] }), undefined, writes);

  expect(screen.getByRole('combobox', { name: 'Status' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Priority' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit assignee' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'New label' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close ticket' })).toBeDisabled();
});