import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { createListViewState, type ListViewState } from '@/lib/view/state';

import { FilterBar } from './filter-bar';

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

function renderBar({
  view = createListViewState(),
  issues = [
    issue('a', { status: 'open', priority: 1, issue_type: 'bug', assignee: 'ada', labels: ['ui'] }),
    issue('b', { status: 'closed', priority: 2, issue_type: 'task', labels: ['backend'] }),
  ],
  visibleCount = 1,
}: {
  view?: ListViewState;
  issues?: Issue[];
  visibleCount?: number;
} = {}) {
  const onChange = vi.fn();
  const onClear = vi.fn();
  render(
    <I18nProvider initialLanguage="en">
      <FilterBar
        view={view}
        issues={issues}
        visibleCount={visibleCount}
        totalCount={issues.length}
        onChange={onChange}
        onClear={onClear}
      />
    </I18nProvider>
  );
  return { onChange, onClear };
}

test('shows the visible and total counts', () => {
  renderBar({ visibleCount: 1 });

  expect(screen.getByText('1 / 2')).toBeInTheDocument();
});

test('editing the search box reports the new query', () => {
  const { onChange } = renderBar();

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search tickets' }), {
    target: { value: 'scroll' },
  });

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      filter: expect.objectContaining({ query: 'scroll' }),
    })
  );
});

test('/ focuses the search box', () => {
  renderBar();

  fireEvent.keyDown(window, { key: '/' });

  expect(screen.getByRole('searchbox', { name: 'Search tickets' })).toHaveFocus();
});

test('a filter menu closes when another opens, on an outside press, or on Escape', () => {
  renderBar();
  const detailsFor = (label: string): HTMLDetailsElement => {
    const menus = Array.from(
      document.querySelectorAll<HTMLDetailsElement>('details[data-filter-menu]')
    );
    const menu = menus.find(
      (candidate) => candidate.querySelector('summary')?.textContent === label
    );
    if (menu === undefined) {
      throw new Error(`no <details> for ${label}`);
    }
    return menu;
  };
  const status = detailsFor('Status');
  const priority = detailsFor('Priority');
  const openMenu = (details: HTMLDetailsElement): HTMLElement => {
    details.open = true;
    return details.querySelector('summary') as HTMLElement;
  };

  // Pressing the next summary closes the one already open before it toggles.
  openMenu(status);
  fireEvent.pointerDown(priority.querySelector('summary') as HTMLElement);
  expect(status.open).toBe(false);

  // A press inside the panel keeps it open (checking an option is not a dismiss).
  openMenu(priority);
  const checkbox = within(priority).getAllByRole('checkbox')[0];
  fireEvent.pointerDown(checkbox);
  expect(priority.open).toBe(true);

  // A press anywhere else dismisses the open panel.
  fireEvent.pointerDown(document.body);
  expect(priority.open).toBe(false);

  // Escape dismisses and returns focus to the trigger.
  const summary = openMenu(priority);
  checkbox.focus();
  fireEvent.keyDown(checkbox, { key: 'Escape' });
  expect(priority.open).toBe(false);
  expect(summary).toHaveFocus();
});

test('a lagging URL update does not overwrite what the user has typed', () => {
  const bar = (view: ListViewState) => (
    <I18nProvider initialLanguage="en">
      <FilterBar
        view={view}
        issues={[]}
        visibleCount={0}
        totalCount={0}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />
    </I18nProvider>
  );
  const { rerender } = render(bar(createListViewState()));
  const search = screen.getByRole('searchbox', { name: 'Search tickets' });
  search.focus();

  fireEvent.change(search, { target: { value: 'fix scroll' } });
  expect(search).toHaveValue('fix scroll');

  // Every keystroke goes through the URL, so a commit can land with the query
  // of the previous keystroke while the next one is already in the field.
  const lagging = createListViewState();
  lagging.filter.query = 'fix scrol';
  rerender(bar(lagging));
  expect(search).toHaveValue('fix scroll');

  // Once the field is not being typed into, external changes win again.
  search.blur();
  rerender(bar(createListViewState()));
  expect(search).toHaveValue('');
});

test('status, priority, type, assignee and label checkboxes update their dimensions', () => {
  const { onChange } = renderBar();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Open' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filter: expect.objectContaining({ status: ['open'] }),
    })
  );

  fireEvent.click(screen.getByRole('checkbox', { name: 'P1' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filter: expect.objectContaining({ priority: [1] }),
    })
  );

  fireEvent.click(screen.getByRole('checkbox', { name: 'bug' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filter: expect.objectContaining({ type: ['bug'] }),
    })
  );

  fireEvent.click(screen.getByRole('checkbox', { name: 'ada' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filter: expect.objectContaining({ assignee: ['ada'] }),
    })
  );

  fireEvent.click(screen.getByRole('checkbox', { name: 'ui' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      filter: expect.objectContaining({ label: ['ui'] }),
    })
  );
});

test('the Ready toggle updates the ready filter', () => {
  const { onChange } = renderBar();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Ready' }));

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      filter: expect.objectContaining({ ready: true }),
    })
  );
});

test('changing the group and sort controls reports the new grouping and direction', () => {
  const { onChange } = renderBar();

  const group = screen.getByRole('group', { name: 'Group by' });
  fireEvent.click(group.querySelector('summary')!);
  fireEvent.click(within(group).getByRole('radio', { name: 'Status' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ group: 'status' }));

  const sort = screen.getByRole('group', { name: 'Sort by' });
  fireEvent.click(sort.querySelector('summary')!);
  fireEvent.click(within(sort).getByRole('radio', { name: 'Priority' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ sort: { by: 'priority', direction: 'asc' } })
  );

  fireEvent.click(screen.getByRole('button', { name: 'Reverse sort direction' }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ sort: { by: 'updated', direction: 'asc' } })
  );
});

test('a selected value that is absent from the current data is still removable', () => {
  const view = createListViewState();
  view.filter.type = ['legacy'];
  renderBar({ view });

  expect(screen.getByRole('checkbox', { name: 'legacy' })).toBeChecked();
});

test('clear filters is not offered without an active filter', () => {
  renderBar();

  expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
});

test('clear filters is offered while a filter is active', () => {
  const view = createListViewState();
  view.filter.query = 'scroll';
  const { onClear } = renderBar({ view });

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('the multi-select panel lists the options found in the data', () => {
  renderBar();

  const statusPanel = screen.getByRole('group', { name: 'Status' });
  fireEvent.click(within(statusPanel).getByText('Status'));
  expect(within(statusPanel).getByRole('checkbox', { name: 'Open' })).toBeVisible();
  expect(within(statusPanel).getByRole('checkbox', { name: 'Closed' })).toBeVisible();
});
