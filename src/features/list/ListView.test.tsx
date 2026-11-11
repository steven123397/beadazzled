import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { Issue, SyncState } from '@/bindings/bd';
import { makeIssue as issue, renderWithI18n } from '@/test/fixtures';

import { ListView } from './ListView';
import { LIST_POSITION_PREFIX, saveListPosition } from './position';
import { createListViewState } from '@/lib/view/state';
import { saveSavedView } from '@/lib/view/storage';

vi.mock('@tanstack/react-virtual', async () => {
  const { makeVirtualizer } = await import('@/test/virtualizer');
  return { useVirtualizer: makeVirtualizer };
});

const healthy: SyncState = { kind: 'healthy', lastSeq: 1, lastEventAt: null };
const loading: SyncState = { kind: 'loading', step: 'export' };
const unavailable: SyncState = {
  kind: 'bd-unavailable',
  error: { code: 'BD_NOT_FOUND', message: 'bd missing' },
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderList({
  issues,
  entry = '/w/p1/list',
  syncState = healthy,
  onRefresh,
  children,
}: {
  issues: readonly Issue[];
  entry?: string;
  syncState?: SyncState;
  onRefresh?: () => void;
  children?: ReactNode;
}) {
  const refresh = onRefresh ?? vi.fn();
  const renderResult = renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      {children}
      <Routes>
        <Route
          path="/w/:projectId/list"
          element={
            <ListView projectId="p1" issues={issues} syncState={syncState} onRefresh={refresh} />
          }
        />
        <Route path="/w/:projectId/issue/:issueId" element={<div>detail</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
  return { ...renderResult, refresh };
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-issue-id="${id}"]`);
  if (element === null) {
    throw new Error(`row ${id} is not rendered`);
  }
  return element;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

test('renders one list item per visible issue', () => {
  renderList({ issues: [issue('bza-1'), issue('bza-2'), issue('bza-3')] });

  expect(screen.getByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(row('bza-2')).toHaveTextContent('Issue bza-2');
});

test('a uniform type is not repeated in every row', () => {
  renderList({ issues: [issue('bza-1'), issue('bza-2')] });

  expect(row('bza-1')).not.toHaveTextContent('task');
});

test('mixed types keep the type column visible', () => {
  renderList({
    issues: [issue('bza-1', { issue_type: 'task' }), issue('bza-2', { issue_type: 'bug' })],
  });

  expect(row('bza-1')).toHaveTextContent('task');
  expect(row('bza-2')).toHaveTextContent('bug');
});

test('J and K move the focused row', async () => {
  renderList({ issues: [issue('bza-1'), issue('bza-2'), issue('bza-3')] });

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-2')).toHaveFocus());

  fireEvent.keyDown(window, { key: 'k' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());
});

test('K starts from the last row when nothing is focused yet', async () => {
  renderList({ issues: [issue('bza-1'), issue('bza-2')] });

  fireEvent.keyDown(window, { key: 'k' });

  await waitFor(() => expect(row('bza-2')).toHaveFocus());
});

test('Enter opens the focused issue', async () => {
  renderList({ issues: [issue('bza-1'), issue('bza-2')] });

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());
  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-2')).toHaveFocus());

  fireEvent.keyDown(row('bza-2'), { key: 'Enter' });

  expect(screen.getByTestId('location')).toHaveTextContent('/w/p1/issue/bza-2');
});

test('clicking a row opens it', () => {
  renderList({ issues: [issue('bza-1'), issue('bza-2')] });

  fireEvent.click(row('bza-2'));

  expect(screen.getByTestId('location')).toHaveTextContent('/w/p1/issue/bza-2');
});

test('J and K are ignored while typing in an input', () => {
  renderList({ issues: [issue('bza-1')], children: <input aria-label="Other input" /> });
  const input = screen.getByRole('textbox', { name: 'Other input' });

  input.focus();
  fireEvent.keyDown(input, { key: 'j' });

  expect(input).toHaveFocus();
  expect(row('bza-1')).not.toHaveFocus();
});

test('restores the saved scroll offset and focused row', async () => {
  sessionStorage.setItem(
    `${LIST_POSITION_PREFIX}p1`,
    JSON.stringify({ scrollTop: 180, focusedId: 'bza-3' })
  );

  renderList({ issues: [issue('bza-1'), issue('bza-2'), issue('bza-3'), issue('bza-4')] });

  await waitFor(() => expect(screen.getByRole('list')).toHaveProperty('scrollTop', 180));
  await waitFor(() => expect(row('bza-3')).toHaveFocus());
});

test('a saved focus that is filtered out does not steal focus later', async () => {
  saveListPosition('p1', { scrollTop: 40, focusedId: 'bza-2' });

  renderList({
    issues: [issue('bza-1', { title: 'Keep me' }), issue('bza-2', { title: 'Other work' })],
    entry: '/w/p1/list?q=keep',
  });

  // Let the restore pass finish while bza-2 is excluded by the deep link.
  await waitFor(() => expect(screen.getByRole('list')).toHaveProperty('scrollTop', 40));
  expect(document.querySelector('[data-issue-id="bza-2"]')).toBeNull();

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
    target: { value: '' },
  });

  await waitFor(() => expect(row('bza-2')).toBeInTheDocument());
  expect(row('bza-2')).not.toHaveFocus();
});

test('saves the scroll offset and focused row on unmount', async () => {
  const view = renderList({ issues: [issue('bza-1'), issue('bza-2')] });

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());
  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-2')).toHaveFocus());

  screen.getByRole('list').scrollTop = 144;
  view.unmount();

  expect(JSON.parse(sessionStorage.getItem(`${LIST_POSITION_PREFIX}p1`) ?? 'null')).toEqual({
    scrollTop: 144,
    focusedId: 'bza-2',
  });
});

test('a loading baseline shows ten skeleton rows, not an empty list', () => {
  renderList({ issues: [], syncState: loading });

  expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'loading');
  expect(screen.getByRole('status', { name: 'Loading tickets' })).toBeInTheDocument();
  expect(screen.getAllByTestId('list-skeleton-row')).toHaveLength(10);
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('an empty workspace explains how to start and keeps creation disabled for now', () => {
  renderList({ issues: [] });

  expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'empty');
  expect(screen.getByText('No tickets yet')).toBeInTheDocument();
  expect(screen.getByText('This workspace has no tickets.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create the first ticket' })).toBeDisabled();
  expect(screen.getByText('Ticket creation arrives with the detail editor.')).toBeInTheDocument();
});

test('filters with no match show the no-match state and can be cleared', async () => {
  renderList({
    issues: [issue('bza-1'), issue('bza-2')],
    entry: '/w/p1/list?q=zzz',
  });

  expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'no-match');
  expect(screen.getByText('No matching tickets')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Show all tickets' }));

  await waitFor(() => expect(row('bza-1')).toBeInTheDocument());
  expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'ready');
  expect(screen.getByTestId('location')).not.toHaveTextContent('q=');
});

test('bd unavailable keeps the last loaded data and marks it stale', () => {
  const { refresh } = renderList({
    issues: [issue('bza-1')],
    syncState: unavailable,
  });

  expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'bd-unavailable');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'bd is unavailable. Showing the last loaded tickets.'
  );
  expect(row('bza-1')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('bd unavailable without cached data shows the error state', () => {
  const { refresh } = renderList({ issues: [], syncState: unavailable });

  expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'bd-unavailable');
  expect(screen.getByRole('alert')).toHaveTextContent('bd is unavailable');
  expect(screen.getByText('bd missing')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('a deep link restores filters, grouping, sorting and the count', () => {
  const issues = [
    issue('a', { title: 'Fix scroll', status: 'open', priority: 0 }),
    issue('b', { title: 'Fix board', status: 'closed', priority: 1 }),
    issue('c', { title: 'Fix other', status: 'open', priority: 2 }),
  ];
  renderList({
    issues,
    entry: '/w/p1/list?q=fix&status=open&group=status&sort=priority%3Aasc',
  });

  expect(screen.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('fix');
  expect(screen.getByText('2 / 3')).toBeInTheDocument();
  expect(row('a')).toBeInTheDocument();
  expect(row('c')).toBeInTheDocument();
  expect(document.querySelector('[data-issue-id="b"]')).toBeNull();
  expect(screen.getByRole('button', { name: /Open/ })).toHaveAttribute('aria-expanded', 'true');
});

test('a workspace reopens with its last saved view', async () => {
  const saved = createListViewState();
  saved.filter.query = 'fix';
  saved.group = 'status';
  saveSavedView('p1', saved);

  renderList({
    issues: [issue('a', { title: 'Fix scroll' }), issue('b', { title: 'Other work' })],
  });

  expect(screen.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('fix');
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=fix'));
});

test('a group header collapses its rows without changing the count', async () => {
  renderList({
    issues: [issue('a', { status: 'open' }), issue('b', { status: 'closed' })],
    entry: '/w/p1/list?group=status',
  });

  const header = screen.getByRole('button', { name: /Open/ });
  expect(row('a')).toBeInTheDocument();
  expect(screen.getByText('2 / 2')).toBeInTheDocument();

  fireEvent.click(header);

  await waitFor(() => expect(header).toHaveAttribute('aria-expanded', 'false'));
  expect(document.querySelector('[data-issue-id="a"]')).toBeNull();
  expect(row('b')).toBeInTheDocument();
  expect(screen.getByText('2 / 2')).toBeInTheDocument();
});

test('typing in the filter bar narrows the rows and the count', async () => {
  renderList({
    issues: [issue('a', { title: 'Fix scroll' }), issue('b', { title: 'Other work' })],
  });

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
    target: { value: 'fix' },
  });

  await waitFor(() => expect(row('a')).toBeInTheDocument());
  expect(document.querySelector('[data-issue-id="b"]')).toBeNull();
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('q=fix');
});

test('clicking the list link keeps the active filters', async () => {
  renderList({
    issues: [issue('a', { title: 'Fix scroll' }), issue('b', { title: 'Other work' })],
    entry: '/w/p1/list?q=fix',
    children: <Link to="/w/p1/list">Go to list</Link>,
  });

  const search = screen.getByRole('searchbox', { name: 'Search tickets' });
  expect(search).toHaveValue('fix');

  fireEvent.click(screen.getByRole('link', { name: 'Go to list' }));

  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/w/p1/list?q=fix'));
  expect(search).toHaveValue('fix');
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
});

test('J, K and slash stay inside an open modal dialog', () => {
  renderList({ issues: [issue('bza-1'), issue('bza-2')] });

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const button = document.createElement('button');
  button.textContent = 'Close';
  dialog.append(button);
  document.body.append(dialog);
  button.focus();

  try {
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: '/' });

    expect(button).toHaveFocus();
    expect(row('bza-1')).not.toHaveFocus();
    expect(screen.getByRole('searchbox', { name: 'Search tickets' })).not.toHaveFocus();
  } finally {
    dialog.remove();
  }
});

test('a journal-degraded workspace still renders its list', () => {
  renderList({
    issues: [issue('bza-1')],
    syncState: { kind: 'journal-disabled' },
  });

  expect(screen.getByTestId('list-view')).toHaveAttribute('data-state', 'ready');
  expect(screen.getByTestId('list-view')).toHaveAttribute('data-sync', 'journal-disabled');
  expect(within(screen.getByRole('list')).getByText('bza-1')).toBeInTheDocument();
});
