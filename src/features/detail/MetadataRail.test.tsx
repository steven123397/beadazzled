import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Dependency, Issue } from '@/bindings/bd';
import { renderWithI18n } from '@/test/fixtures';
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
  renderWithI18n(<MetadataRail issue={target} index={indexIssues(issues)} writes={writes} />);
}

function submitted(writes: UseWrite) {
  return vi.mocked(writes.submit).mock.calls.map(([submission]) => submission.build());
}

/** The popover renders its radios inside a closed `<details>`; open it first. */
function menu(label: 'Status' | 'Priority'): HTMLDetailsElement {
  const details = document.querySelector<HTMLDetailsElement>(`details[aria-label="${label}"]`);
  if (details === null) {
    throw new Error(`no ${label} menu`);
  }
  details.open = true;
  return details;
}

function choose(label: 'Status' | 'Priority', option: RegExp) {
  fireEvent.click(within(menu(label)).getByRole('radio', { name: option }));
}

test('a blocked target is disabled in the status menu and refuses to submit', () => {
  const blocker = issue('bza-a');
  const target = issue('bza-b', { dependencies: [blockerEdge('bza-a')] });
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(target, [target, blocker], writes);

  const status = menu('Status');
  expect(within(status).getByRole('radio', { name: /In progress/ })).toBeDisabled();
  expect(within(status).getByRole('radio', { name: /Closed/ })).toBeDisabled();
  expect(within(status).getByRole('radio', { name: /Blocked/ })).toBeEnabled();

  expect(writes.submit).not.toHaveBeenCalled();
});

test('an unblocked status change carries the expected-status guard', async () => {
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(issue('bza-b'), undefined, writes);

  choose('Status', /In progress/);

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
    within(menu('Status')).getByRole('radio', {
      name: /In progress/,
    })
  ).toBeEnabled();
});

test('a target outside the store still counts as an unresolved blocker', () => {
  const target = issue('bza-b', { dependencies: [blockerEdge('bza-gone')] });
  renderRail(target, [target], fakeWrites());

  expect(
    within(menu('Status')).getByRole('radio', {
      name: /Closed/,
    })
  ).toBeDisabled();
});

test('priority changes submit with the current status guard', async () => {
  const writes = fakeWrites({ submit: vi.fn(async () => ({ status: 'ok' as const })) });
  renderRail(issue('bza-b', { status: 'in_progress' }), undefined, writes);

  choose('Priority', /^P1$/);

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
  await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'Assignee' })).toBeNull());
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

  fireEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'New label' }), {
    target: { value: 'backend' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  expect(submitted(writes)[0]).toMatchObject({ Update: { add_labels: ['backend'] } });
  await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: 'New label' })).toBeNull());

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

test('a failed status write reports the error and leaves the control usable', async () => {
  const writes = fakeWrites({
    submit: vi.fn(async () => ({
      status: 'failed' as const,
      error: { code: 'BD_LOCKED' as const, message: 'the database is busy' },
    })),
  });
  renderRail(issue('bza-b'), undefined, writes);

  choose('Status', /In progress/);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The beads database is busy; try again in a moment.'
  );
  // The failed write never reached the store, so the trigger snaps back.
  expect(document.getElementById('detail-status')).toHaveAttribute('aria-label', 'Status: Open');
  expect(document.getElementById('detail-status')).not.toHaveAttribute('aria-disabled');

  choose('Status', /Deferred/);
  await vi.waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(2));
});

test('a failed status write returns focus to the status trigger', async () => {
  const writes = fakeWrites({
    submit: vi.fn(async () => ({
      status: 'failed' as const,
      error: { code: 'BD_LOCKED' as const, message: 'the database is busy' },
    })),
  });
  renderRail(issue('bza-b'), undefined, writes);
  document.getElementById('detail-status')?.focus();

  choose('Status', /In progress/);

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  // The remount must hand focus back instead of dropping it to the body.
  await vi.waitFor(() => expect(document.getElementById('detail-status')).toHaveFocus());
});

test('a failed priority write returns focus to the priority trigger', async () => {
  const writes = fakeWrites({
    submit: vi.fn(async () => ({
      status: 'failed' as const,
      error: { code: 'BD_LOCKED' as const, message: 'the database is busy' },
    })),
  });
  renderRail(issue('bza-b'), undefined, writes);
  document.getElementById('detail-priority')?.focus();

  choose('Priority', /^P1$/);

  expect(await screen.findByRole('alert')).toBeInTheDocument();
  await vi.waitFor(() => expect(document.getElementById('detail-priority')).toHaveFocus());
});

test('a conflict while adding a label keeps the typed label', async () => {
  const writes = fakeWrites({
    submit: vi.fn(async () => ({
      status: 'conflict' as const,
      error: { code: 'WRITE_CONFLICT' as const, message: 'stale snapshot' },
    })),
  });
  renderRail(issue('bza-b'), undefined, writes);

  fireEvent.click(screen.getByRole('button', { name: 'Edit labels' }));
  const input = screen.getByRole('textbox', { name: 'New label' });
  fireEvent.change(input, { target: { value: 'backend' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This issue changed elsewhere; refreshing the view.'
  );
  expect(input).toHaveValue('backend');
});

test('a status and priority from a newer bd stay visible and selectable', () => {
  renderRail(issue('bza-b', { status: 'review', priority: 7 }), undefined, fakeWrites());

  expect(document.getElementById('detail-status')).toHaveAttribute('aria-label', 'Status: review');
  expect(within(menu('Status')).getByRole('radio', { name: 'review' })).toBeInTheDocument();
  expect(within(menu('Status')).getByRole('radio', { name: 'Open' })).toBeInTheDocument();

  expect(document.getElementById('detail-priority')).toHaveAttribute('aria-label', 'Priority: P7');
  expect(within(menu('Priority')).getByRole('radio', { name: 'P7' })).toBeInTheDocument();
});

test('pending writes disable every metadata control', () => {
  const writes = fakeWrites({ isPending: () => true, pending: ['bza-b'] });
  renderRail(issue('bza-b', { assignee: 'ada', labels: ['ui'] }), undefined, writes);

  expect(document.getElementById('detail-status')).toHaveAttribute('aria-disabled', 'true');
  expect(document.getElementById('detail-priority')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('button', { name: 'Edit assignee' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Edit labels' })).toBeDisabled();
  expect(screen.queryByRole('textbox', { name: 'New label' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Close ticket' })).toBeDisabled();
});
