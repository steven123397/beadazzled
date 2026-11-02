import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';

import type { Issue } from '@/bindings/bd';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import type { UseWrite } from '@/lib/writes/useWrite';

import { BoardView } from './BoardView';

/** Captures the board's real `onDragEnd` prop; no pointer simulation needed. */
const capture = vi.hoisted(() => ({
  onDragEnd: null as null | ((event: DragEndEvent) => void),
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  const Actual = actual.DndContext;
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof Actual>) => {
      capture.onDragEnd = props.onDragEnd ?? null;
      return <Actual {...props} />;
    },
  };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: {
    count: number;
    estimateSize: (index: number) => number;
    getItemKey: (index: number) => string | number;
  }) => {
    const sizes = Array.from({ length: options.count }, (_, index) => options.estimateSize(index));
    const starts: number[] = [];
    let total = 0;
    for (const size of sizes) {
      starts.push(total);
      total += size;
    }
    return {
      getTotalSize: () => total,
      getVirtualItems: () =>
        sizes.map((size, index) => ({
          index,
          start: starts[index] ?? 0,
          size,
          key: options.getItemKey(index),
        })),
      scrollToIndex: vi.fn(),
      scrollToOffset: vi.fn(),
    };
  },
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

function fakeWrites(overrides: Partial<UseWrite> = {}): UseWrite {
  return {
    pending: [],
    error: null,
    result: null,
    canWrite: true,
    disabledReason: null,
    isPending: () => false,
    submit: vi.fn(async () => ({ status: 'ok' as const, echo: 'echoed' as const })),
    clearError: vi.fn(),
    ...overrides,
  };
}

function renderBoard(issues: readonly Issue[], writes?: UseWrite) {
  return render(
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

function drop(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test('a drop produces the same command as the keyboard move', async () => {
  const writes = fakeWrites();
  renderBoard([issue('bza-1')], writes);
  await waitFor(() => expect(capture.onDragEnd).not.toBeNull());

  act(() => capture.onDragEnd?.(drop('bza-1', 'in-progress')));

  await waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(1));
  const submission = vi.mocked(writes.submit).mock.calls[0]![0];
  expect(submission.build()).toMatchObject({
    Update: { id: 'bza-1', status: 'in_progress', if_status: 'open' },
  });
});

test('a drop on Blocked is refused before any write', async () => {
  const writes = fakeWrites();
  renderBoard([issue('bza-1')], writes);
  await waitFor(() => expect(capture.onDragEnd).not.toBeNull());

  act(() => capture.onDragEnd?.(drop('bza-1', 'blocked')));

  expect(screen.getByRole('alert')).toHaveTextContent('does not accept drops');
  expect(writes.submit).not.toHaveBeenCalled();
});

test('a drop outside any column is a no-op', async () => {
  const writes = fakeWrites();
  renderBoard([issue('bza-1')], writes);
  await waitFor(() => expect(capture.onDragEnd).not.toBeNull());

  act(() => capture.onDragEnd?.(drop('bza-1', null)));

  expect(writes.submit).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a drop from Done submits reopen before the target status', async () => {
  const writes = fakeWrites();
  renderBoard([issue('bza-1', { status: 'closed' })], writes);
  await waitFor(() => expect(capture.onDragEnd).not.toBeNull());

  act(() => capture.onDragEnd?.(drop('bza-1', 'in-progress')));

  await waitFor(() => expect(writes.submit).toHaveBeenCalledTimes(2));
  const commands = vi.mocked(writes.submit).mock.calls.map(([submission]) => submission.build());
  expect(commands[0]).toMatchObject({ Reopen: { id: 'bza-1' } });
  expect(commands[1]).toMatchObject({
    Update: { id: 'bza-1', status: 'in_progress', if_status: 'open' },
  });
});
