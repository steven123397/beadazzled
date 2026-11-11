import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import type { Issue, SyncState } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import type { UseWrite } from '@/lib/writes/useWrite';
import { fakeEchoWrites as fakeWrites } from '@/test/detail-writes';
import { makeIssue as issue, renderWithI18n, TEST_TS as TS } from '@/test/fixtures';

import { BoardView } from './BoardView';

vi.mock('@tanstack/react-virtual', async () => {
  const { makeVirtualizer } = await import('@/test/virtualizer');
  return { useVirtualizer: makeVirtualizer };
});

const healthy: SyncState = { kind: 'healthy', lastSeq: 1, lastEventAt: null };
const loading: SyncState = { kind: 'loading', step: 'export' };

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function BoardHarness({ issues, writes }: { issues: readonly Issue[]; writes?: UseWrite }) {
  return (
    <I18nProvider initialLanguage="en">
      <MemoryRouter initialEntries={['/w/p1/board']}>
        <Routes>
          <Route
            path="/w/:projectId/board"
            element={<BoardView projectId="p1" issues={issues} writes={writes} />}
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  );
}

function renderBoard({
  issues,
  entry = '/w/p1/board',
  syncState = healthy,
  writes,
}: {
  issues: readonly Issue[];
  entry?: string;
  syncState?: SyncState;
  writes?: UseWrite;
}) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/w/:projectId/board"
          element={
            <BoardView projectId="p1" issues={issues} syncState={syncState} writes={writes} />
          }
        />
        <Route path="/w/:projectId/issue/:issueId" element={<div>detail</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

function column(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-column-id="${id}"]`);
  if (element === null) {
    throw new Error(`column ${id} is not rendered`);
  }
  return element;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('renders the five fixed columns with derived membership', () => {
  renderBoard({
    issues: [
      issue('bza-1'),
      issue('bza-2'),
      issue('bza-3', { status: 'in_progress' }),
      issue('bza-4', { status: 'closed' }),
      issue('bza-5', { status: 'deferred' }),
      issue('bza-6', {
        dependencies: [
          { issue_id: 'bza-6', depends_on_id: 'bza-1', type: 'blocks', created_at: TS },
        ],
      }),
    ],
  });

  expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
  expect(column('ready')).toHaveAccessibleName('Ready');
  expect(within(column('ready')).getAllByRole('listitem')).toHaveLength(2);
  expect(within(column('in-progress')).getAllByRole('listitem')).toHaveLength(1);
  expect(within(column('backlog')).getAllByRole('listitem')).toHaveLength(1);
  expect(within(column('blocked')).getAllByRole('listitem')).toHaveLength(1);
  expect(within(column('done')).getAllByRole('listitem')).toHaveLength(1);

  // Ready is sorted by priority and then most recently updated; the blocker
  // target bza-1 is P2 while bza-2 is P2 too, so id order breaks the tie.
  expect(within(column('ready')).getAllByRole('listitem')[0]).toHaveAttribute(
    'data-issue-id',
    'bza-1'
  );
});

test('Other is hidden until a pinned or unknown ticket exists', () => {
  const plain = [issue('bza-1')];
  renderBoard({ issues: plain });
  expect(document.querySelector('[data-column-id="other"]')).toBeNull();
});

test('Other shows pinned and unknown tickets', () => {
  renderBoard({
    issues: [issue('bza-1'), issue('bza-2', { status: 'pinned' }), issue('bza-3', { status: 'x' })],
  });

  expect(within(column('other')).getAllByRole('listitem')).toHaveLength(2);
});

test('the status filter is ignored and its controls are hidden', () => {
  renderBoard({
    issues: [issue('bza-1'), issue('bza-2', { status: 'closed' })],
    entry: '/w/p1/board?status=closed',
  });

  // The open ticket is still in Ready: columns, not the URL, express status.
  expect(within(column('ready')).getAllByRole('listitem')).toHaveLength(1);
  expect(within(column('done')).getAllByRole('listitem')).toHaveLength(1);
  expect(document.querySelector('details[aria-label="Status"]')).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Group by' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Sort by' })).not.toBeInTheDocument();
});

test('filtering narrows every column but keeps the columns and the status param', () => {
  renderBoard({
    issues: [
      issue('bza-1', { title: 'Alpha one' }),
      issue('bza-2', { title: 'Beta two' }),
      issue('bza-3', { title: 'Alpha closed', status: 'closed' }),
    ],
    entry: '/w/p1/board?status=closed',
  });

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
    target: { value: 'Alpha' },
  });

  expect(within(column('ready')).getAllByRole('listitem')).toHaveLength(1);
  expect(within(column('done')).getAllByRole('listitem')).toHaveLength(1);
  expect(within(column('blocked')).queryAllByRole('listitem')).toHaveLength(0);
  expect(screen.getByText('2 / 3')).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('status=closed');
});

test('clicking a card opens its detail route', () => {
  renderBoard({ issues: [issue('bza-1')] });

  fireEvent.click(within(column('ready')).getAllByRole('listitem')[0]!);
  expect(screen.getByTestId('location')).toHaveTextContent('/w/p1/issue/bza-1');
});

test('loading and empty states are distinct', () => {
  const { unmount } = renderWithI18n(
    <MemoryRouter initialEntries={['/w/p1/board']}>
      <Routes>
        <Route
          path="/w/:projectId/board"
          element={<BoardView projectId="p1" issues={[]} syncState={loading} />}
        />
      </Routes>
    </MemoryRouter>
  );
  expect(screen.getByRole('status', { name: 'Loading tickets' })).toBeInTheDocument();
  unmount();

  renderBoard({ issues: [], syncState: healthy });
  expect(screen.getByText('No tickets yet')).toBeInTheDocument();
});

function card(issueId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-issue-id="${issueId}"]`);
  if (element === null) {
    throw new Error(`card ${issueId} is not rendered`);
  }
  return element;
}

test('H, L, J and K move focus without calling bd', async () => {
  const writes = fakeWrites();
  renderBoard({
    issues: [issue('bza-1'), issue('bza-2'), issue('bza-3', { status: 'in_progress' })],
    writes,
  });

  expect(card('bza-1')).toHaveAttribute('data-focused', 'true');

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(card('bza-2')).toHaveAttribute('data-focused', 'true'));

  fireEvent.keyDown(window, { key: 'l' });
  await waitFor(() => expect(card('bza-3')).toHaveAttribute('data-focused', 'true'));

  fireEvent.keyDown(window, { key: 'h' });
  await waitFor(() => expect(card('bza-1')).toHaveAttribute('data-focused', 'true'));

  fireEvent.keyDown(window, { key: 'k' });
  await waitFor(() => expect(card('bza-1')).toHaveAttribute('data-focused', 'true'));

  expect(writes.submit).not.toHaveBeenCalled();
});

test('Enter opens the focused card', async () => {
  renderBoard({ issues: [issue('bza-1')] });

  await waitFor(() => expect(card('bza-1')).toHaveAttribute('data-focused', 'true'));
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(screen.getByTestId('location')).toHaveTextContent('/w/p1/issue/bza-1');
});

test('Shift+Right produces the same command sequence as a drag', async () => {
  const writes = fakeWrites();
  renderBoard({ issues: [issue('bza-1')], writes });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  await waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  const submission = vi.mocked(writes.submit).mock.calls[0]![0];
  const command = submission.build();
  expect(command).toMatchObject({
    Update: { id: 'bza-1', status: 'in_progress', if_status: 'open' },
  });
  const moved = await screen.findByText('Moved bza-1 to In Progress', {
    selector: '[role="status"]',
  });
  expect(moved).toHaveAttribute('aria-live', 'polite');
});

test('a move is not optimistic: the card stays put with a pending marker', async () => {
  let settle!: (result: { status: 'ok'; echo: 'echoed' }) => void;
  const submit = vi.fn(
    () =>
      new Promise<{ status: 'ok'; echo: 'echoed' }>((resolve) => {
        settle = resolve;
      })
  );
  const writes = fakeWrites({ submit: submit as UseWrite['submit'] });
  renderBoard({ issues: [issue('bza-1')], writes });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  await waitFor(() => expect(card('bza-1')).toHaveAttribute('data-pending', 'true'));
  expect(card('bza-1').closest('[data-column-id="ready"]')).not.toBeNull();
  // Pending disables the keyboard drag activator too.
  expect(screen.getByRole('button', { name: 'Drag bza-1' })).toHaveAttribute(
    'aria-disabled',
    'true'
  );

  await act(async () => settle({ status: 'ok', echo: 'echoed' }));
  await waitFor(() => expect(card('bza-1')).not.toHaveAttribute('data-pending'));
});

test('Blocked cards refuse keyboard moves and explain why', () => {
  const writes = fakeWrites();
  renderBoard({ issues: [issue('bza-1', { status: 'blocked' })], writes });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  expect(writes.submit).not.toHaveBeenCalled();
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Blocked cards cannot move out of this column');
  expect(alert).toHaveAttribute('aria-live', 'assertive');
  expect(card('bza-1').closest('[data-column-id="blocked"]')).not.toBeNull();
});

test('a conflict is reported once and never retried', async () => {
  const submit = vi.fn(async () => ({
    status: 'conflict' as const,
    error: { code: 'WRITE_CONFLICT' as const, message: '' },
  }));
  const writes = fakeWrites({ submit: submit as UseWrite['submit'] });
  renderBoard({ issues: [issue('bza-1')], writes });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('This issue changed elsewhere')
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(card('bza-1').closest('[data-column-id="ready"]')).not.toBeNull();
});

test('a rejected close shows the bd reason and keeps the card in place', async () => {
  const submit = vi.fn(async () => ({
    status: 'failed' as const,
    error: {
      code: 'BD_EXIT_NONZERO' as const,
      message: '',
      detail: { stderr: 'cannot close bza-1: 1 open child' },
    },
  }));
  const writes = fakeWrites({ submit: submit as UseWrite['submit'] });
  renderBoard({ issues: [issue('bza-1', { status: 'in_progress' })], writes });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('cannot close bza-1: 1 open child')
  );
  expect(card('bza-1').closest('[data-column-id="in-progress"]')).not.toBeNull();
});

test('a Done card reopens before taking the target status', async () => {
  const writes = fakeWrites();
  renderBoard({ issues: [issue('bza-1', { status: 'closed' })], writes });

  // Done -> In Progress is the adjacent droppable column on the left.
  fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });

  await waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(2));
  const commands = vi.mocked(writes.submit).mock.calls.map(([submission]) => submission.build());
  expect(commands[0]).toMatchObject({ Reopen: { id: 'bza-1' } });
  expect(commands[1]).toMatchObject({
    Update: { id: 'bza-1', status: 'in_progress', if_status: 'open' },
  });
});

test('a failure in the second command stops the sequence and is reported once', async () => {
  const submit = vi
    .fn()
    .mockResolvedValueOnce({ status: 'ok' as const, echo: 'echoed' as const })
    .mockResolvedValueOnce({
      status: 'conflict' as const,
      error: { code: 'WRITE_CONFLICT' as const, message: '' },
    });
  const writes = fakeWrites({ submit: submit as UseWrite['submit'] });
  renderBoard({ issues: [issue('bza-1', { status: 'closed' })], writes });

  // Done -> In Progress submits reopen, then the guarded update.
  fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });

  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('This issue changed elsewhere')
  );
  expect(submit).toHaveBeenCalledTimes(2);
  expect(card('bza-1').closest('[data-column-id="done"]')).not.toBeNull();
});

test('an echo timeout is reported and stops a two-command move', async () => {
  const submit = vi.fn(async () => ({ status: 'ok' as const, echo: 'timeout' as const }));
  const writes = fakeWrites({ submit: submit as UseWrite['submit'] });
  renderBoard({ issues: [issue('bza-1', { status: 'closed' })], writes });

  // Done -> In Progress: the reopen is not confirmed, so the guarded update
  // must never be sent and the move must not be announced as done.
  fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true });

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('was sent but not confirmed')
  );
  expect(submit).toHaveBeenCalledTimes(1);
  expect(card('bza-1').closest('[data-column-id="done"]')).not.toBeNull();
  expect(screen.queryByText(/^Moved /)).not.toBeInTheDocument();
});

test('without a write flow a move is refused visibly and never reaches bd', () => {
  renderBoard({ issues: [issue('bza-1')] });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  expect(screen.getByRole('alert')).toHaveTextContent('bd is not available; moving is disabled');
  expect(card('bza-1').closest('[data-column-id="ready"]')).not.toBeNull();
});

test('clearing the last blocker moves the card from Blocked to Ready', () => {
  const dependent = issue('bza-1', {
    dependencies: [{ issue_id: 'bza-1', depends_on_id: 'bza-2', type: 'blocks', created_at: TS }],
  });
  const blocker = issue('bza-2');
  const { rerender } = render(<BoardHarness issues={[dependent, blocker]} />);

  expect(card('bza-1').closest('[data-column-id="blocked"]')).not.toBeNull();

  // The journal closing the blocker arrives as a new issue list; the derived
  // column changes without any user action.
  rerender(<BoardHarness issues={[dependent, { ...blocker, status: 'closed' }]} />);

  expect(card('bza-1').closest('[data-column-id="ready"]')).not.toBeNull();
});

test('a blocked-by target outside the current filter still keeps the card Blocked', () => {
  const blocker = issue('bza-2', { labels: ['infra'] });
  const dependent = issue('bza-1', {
    labels: ['ui'],
    dependencies: [{ issue_id: 'bza-1', depends_on_id: 'bza-2', type: 'blocks', created_at: TS }],
  });
  renderBoard({
    issues: [blocker, dependent],
    entry: '/w/p1/board?label=ui',
  });

  expect(within(column('blocked')).queryAllByRole('listitem')).toHaveLength(1);
  expect(within(column('ready')).queryAllByRole('listitem')).toHaveLength(0);
});

test('Enter on a filter summary opens the filter instead of the focused card', () => {
  renderBoard({ issues: [issue('bza-1')] });
  const summary = document.querySelector<HTMLElement>('details[aria-label="Priority"] summary');
  expect(summary).not.toBeNull();
  summary?.focus();

  fireEvent.keyDown(summary!, { key: 'Enter' });

  expect(screen.getByTestId('location')).not.toHaveTextContent('/issue/');
});

test('Enter on Clear keeps the control native and does not open a card', () => {
  renderBoard({ issues: [issue('bza-1')], entry: '/w/p1/board?priority=2' });
  const clear = screen.getByRole('button', { name: 'Clear filters' });
  clear.focus();

  fireEvent.keyDown(clear, { key: 'Enter' });

  expect(screen.getByTestId('location')).not.toHaveTextContent('/issue/');
});

test('Shift+Arrow on a filter control does not move a card', () => {
  const writes = fakeWrites();
  renderBoard({ issues: [issue('bza-1')], writes });
  const summary = document.querySelector<HTMLElement>('details[aria-label="Priority"] summary');
  expect(summary).not.toBeNull();
  summary?.focus();

  fireEvent.keyDown(summary!, { key: 'ArrowRight', shiftKey: true });

  expect(writes.submit).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeEmptyDOMElement();
});

test('a stale focused card is replaced so the board stays tabbable', async () => {
  const { rerender } = render(<BoardHarness issues={[issue('bza-1'), issue('bza-2')]} />);

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(card('bza-2')).toHaveAttribute('data-focused', 'true'));

  rerender(<BoardHarness issues={[issue('bza-1')]} />);

  await waitFor(() => expect(card('bza-1')).toHaveAttribute('data-focused', 'true'));
  expect(card('bza-1')).toHaveAttribute('tabindex', '0');
});

test('clearing board filters keeps the hidden status parameter', () => {
  renderBoard({
    issues: [issue('bza-1'), issue('bza-2', { status: 'closed' })],
    entry: '/w/p1/board?status=closed&priority=2',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

  expect(screen.getByTestId('location')).toHaveTextContent('status=closed');
  expect(screen.getByTestId('location')).not.toHaveTextContent('priority=');
});

test('a second move is ignored while the first is still pending', async () => {
  let settle!: (result: { status: 'ok'; echo: 'echoed' }) => void;
  const submit = vi.fn(
    () =>
      new Promise<{ status: 'ok'; echo: 'echoed' }>((resolve) => {
        settle = resolve;
      })
  );
  const writes = fakeWrites({ submit: submit as UseWrite['submit'] });
  renderBoard({ issues: [issue('bza-1')], writes });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
  await waitFor(() => expect(card('bza-1')).toHaveAttribute('data-pending', 'true'));

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });
  expect(submit).toHaveBeenCalledTimes(1);

  await act(async () => settle({ status: 'ok', echo: 'echoed' }));
});

test('a card with a write in flight from elsewhere refuses a move', () => {
  const writes = fakeWrites({ isPending: () => true });
  renderBoard({ issues: [issue('bza-1')], writes });

  fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true });

  expect(writes.submit).not.toHaveBeenCalled();
});

test('remounting the board restores the focused card', async () => {
  const issues = [issue('bza-1'), issue('bza-2')];
  const first = renderBoard({ issues });

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(card('bza-2')).toHaveAttribute('data-focused', 'true'));

  first.unmount();
  renderBoard({ issues });

  await waitFor(() => expect(card('bza-2')).toHaveAttribute('data-focused', 'true'));
  expect(card('bza-2')).toHaveFocus();
});
