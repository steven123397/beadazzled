import { DndContext } from '@dnd-kit/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';

import { Card } from './Card';
import type { BoardCard } from './columns';

const TS = '2026-11-01T00:00:00Z';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'bza-1',
    title: 'Board card',
    description: '',
    status: 'open',
    priority: 1,
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

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return { issue: issue(), blockers: [], manual: false, ...overrides };
}

function renderCard(value: BoardCard, props: { pending?: boolean; focused?: boolean } = {}) {
  const onOpen = vi.fn();
  const onFocus = vi.fn();
  render(
    <I18nProvider initialLanguage="en">
      <DndContext>
        <Card
          card={value}
          column="ready"
          start={0}
          focused={props.focused ?? false}
          pending={props.pending}
          onOpen={onOpen}
          onFocus={onFocus}
        />
      </DndContext>
    </I18nProvider>
  );
  return { onOpen, onFocus };
}

test('shows priority, id, title, labels and assignee', () => {
  renderCard(
    card({
      issue: issue({
        title: 'Fix the board',
        priority: 3,
        labels: ['ui', 'board', 'perf'],
        assignee: 'ada',
      }),
    })
  );

  expect(screen.getByText('P3')).toBeInTheDocument();
  expect(screen.getByText('bza-1')).toBeInTheDocument();
  expect(screen.getByText('Fix the board')).toBeInTheDocument();
  expect(screen.getByText('ui')).toBeInTheDocument();
  expect(screen.getByText('board')).toBeInTheDocument();
  // The third label collapses into the +N counter.
  expect(screen.getByText('+1')).toBeInTheDocument();
  expect(screen.getByText('ada')).toBeInTheDocument();
});

test('dependency-blocked cards name the blockers and the cause', () => {
  renderCard(
    card({
      issue: issue({ title: 'Waiting' }),
      blockers: ['bza-a', 'bza-b'],
      manual: false,
    })
  );

  expect(screen.getByText('Blocked by 2')).toBeInTheDocument();
  expect(screen.getByText('bza-a, bza-b')).toBeInTheDocument();
  expect(screen.getByText('dependency')).toBeInTheDocument();
  expect(screen.queryByText('marked blocked')).not.toBeInTheDocument();
});

test('manually blocked cards are labelled as such', () => {
  renderCard(
    card({
      issue: issue({ status: 'blocked' }),
      blockers: [],
      manual: true,
    })
  );

  expect(screen.getByText('marked blocked')).toBeInTheDocument();
  expect(screen.queryByText(/^Blocked by/)).not.toBeInTheDocument();
});

test('a pending card says it is saving', () => {
  renderCard(card(), { pending: true });

  expect(within(screen.getByRole('listitem')).getByRole('status')).toHaveTextContent('Saving…');
  expect(screen.getByRole('listitem')).toHaveAttribute('data-pending', 'true');
});

test('clicking or focusing a card reports the issue', () => {
  const { onOpen, onFocus } = renderCard(card({ issue: issue({ id: 'bza-9' }) }));

  fireEvent.click(screen.getByRole('listitem'));
  fireEvent.focus(screen.getByRole('listitem'));

  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'bza-9' }));
  expect(onFocus).toHaveBeenCalledWith('bza-9');
});
