import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import type { Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';

import { ListView } from './ListView';
import { LIST_POSITION_PREFIX } from './position';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 36,
        size: 36,
        key: index,
      })),
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
  }),
}));

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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderList(issues: readonly Issue[], withInput = false) {
  render(
    <I18nProvider initialLanguage="en">
      <MemoryRouter initialEntries={['/w/p1/list']}>
        {withInput ? <input aria-label="Filter issues" /> : null}
        <Routes>
          <Route path="/w/:projectId/list" element={<ListView projectId="p1" issues={issues} />} />
          <Route path="/w/:projectId/issue/:issueId" element={<div>detail</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>
  );
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
});

test('renders one option per visible issue', () => {
  renderList([issue('bza-1'), issue('bza-2'), issue('bza-3')]);

  expect(screen.getByRole('heading', { name: 'List' })).toBeInTheDocument();
  expect(screen.getAllByRole('option')).toHaveLength(3);
  expect(row('bza-2')).toHaveTextContent('Issue bza-2');
});

test('J and K move the focused row', async () => {
  renderList([issue('bza-1'), issue('bza-2'), issue('bza-3')]);

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-2')).toHaveFocus());

  fireEvent.keyDown(window, { key: 'k' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());
});

test('K starts from the last row when nothing is focused yet', async () => {
  renderList([issue('bza-1'), issue('bza-2')]);

  fireEvent.keyDown(window, { key: 'k' });

  await waitFor(() => expect(row('bza-2')).toHaveFocus());
});

test('Enter opens the focused issue', async () => {
  renderList([issue('bza-1'), issue('bza-2')]);

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());
  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-2')).toHaveFocus());

  fireEvent.keyDown(row('bza-2'), { key: 'Enter' });

  expect(screen.getByTestId('location')).toHaveTextContent('/w/p1/issue/bza-2');
});

test('clicking a row opens it', () => {
  renderList([issue('bza-1'), issue('bza-2')]);

  fireEvent.click(row('bza-2'));

  expect(screen.getByTestId('location')).toHaveTextContent('/w/p1/issue/bza-2');
});

test('J and K are ignored while typing in an input', () => {
  renderList([issue('bza-1')], true);
  const input = screen.getByRole('textbox', { name: 'Filter issues' });

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

  renderList([issue('bza-1'), issue('bza-2'), issue('bza-3'), issue('bza-4')]);

  await waitFor(() => expect(screen.getByRole('listbox')).toHaveProperty('scrollTop', 180));
  await waitFor(() => expect(row('bza-3')).toHaveFocus());
});

test('saves the scroll offset and focused row on unmount', async () => {
  const view = render(
    <I18nProvider initialLanguage="en">
      <MemoryRouter initialEntries={['/w/p1/list']}>
        <Routes>
          <Route
            path="/w/:projectId/list"
            element={<ListView projectId="p1" issues={[issue('bza-1'), issue('bza-2')]} />}
          />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  );

  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-1')).toHaveFocus());
  fireEvent.keyDown(window, { key: 'j' });
  await waitFor(() => expect(row('bza-2')).toHaveFocus());

  screen.getByRole('listbox').scrollTop = 144;
  view.unmount();

  expect(JSON.parse(sessionStorage.getItem(`${LIST_POSITION_PREFIX}p1`) ?? 'null')).toEqual({
    scrollTop: 144,
    focusedId: 'bza-2',
  });
});
