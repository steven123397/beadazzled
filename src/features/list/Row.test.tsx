import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';

import { Row } from './Row';

const TS = '2026-11-01T00:00:00Z';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'bza-42',
    title: 'Fix scroll jank',
    description: '',
    status: 'open',
    priority: 0,
    issue_type: 'bug',
    assignee: 'ada',
    created_at: TS,
    updated_at: TS,
    labels: ['ui', 'backend', 'perf'],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function renderRow(overrides: Partial<Issue> = {}, focused = false) {
  const onOpen = vi.fn();
  const onFocus = vi.fn();
  render(
    <I18nProvider initialLanguage="en">
      <Row
        issue={issue(overrides)}
        start={36}
        focused={focused}
        onOpen={onOpen}
        onFocus={onFocus}
      />
    </I18nProvider>
  );
  return { row: screen.getByRole('listitem'), onOpen, onFocus };
}

test('a row exposes status, id, title, priority, type, assignee and capped labels', () => {
  const { row } = renderRow();

  expect(row).toHaveAttribute('data-issue-id', 'bza-42');
  expect(row).toHaveTextContent('Open');
  expect(row).toHaveTextContent('bza-42');
  expect(row).toHaveTextContent('Fix scroll jank');
  expect(row).toHaveTextContent('P0');
  expect(row).toHaveTextContent('bug');
  expect(row).toHaveTextContent('ada');
  expect(row).toHaveTextContent('ui');
  expect(row).toHaveTextContent('backend');
  expect(row).not.toHaveTextContent('perf');
  expect(row).toHaveTextContent('+1');
});

test('an unknown status shows its raw value instead of a blank cell', () => {
  const { row } = renderRow({ status: 'mystery' });

  expect(row).toHaveTextContent('mystery');
});

test('an unassigned issue says so', () => {
  const { row } = renderRow({ assignee: undefined });

  expect(row).toHaveTextContent('Unassigned');
});

test('the focused row is selected and reachable by tab', () => {
  const { row } = renderRow({}, true);

  expect(row).toHaveAttribute('aria-current', 'true');
  expect(row).toHaveAttribute('data-focused', 'true');
  expect(row).toHaveAttribute('tabindex', '0');
});

test('clicking or focusing a row reports the issue', () => {
  const { row, onOpen, onFocus } = renderRow();

  fireEvent.click(row);
  fireEvent.focus(row);

  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'bza-42' }));
  expect(onFocus).toHaveBeenCalledWith('bza-42');
});

test('the row is positioned at the virtualizer offset', () => {
  const { row } = renderRow();

  expect(row).toHaveStyle({ transform: 'translateY(36px)' });
});
