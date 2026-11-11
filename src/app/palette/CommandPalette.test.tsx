import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { renderWithI18n } from '@/test/fixtures';

import type { CommandItem } from './commands';
import { CommandPalette } from './CommandPalette';

function commands(run: () => void): CommandItem[] {
  return [
    {
      id: 'nav:list',
      title: 'Go to List',
      group: 'Navigation',
      keywords: 'issues tickets',
      run,
    },
    {
      id: 'action:refresh',
      title: 'Refresh data',
      group: 'Actions',
      keywords: 'reload sync',
      run,
    },
    {
      id: 'issue:bza-9xy',
      title: 'Detail reading',
      subtitle: 'bza-9xy',
      group: 'Issues',
      keywords: 'bza-9xy',
      run,
    },
  ];
}

function open(items: CommandItem[], onClose = vi.fn()) {
  renderWithI18n(<CommandPalette commands={items} onClose={onClose} />);
  return onClose;
}

test('opens as a dialog with every command', () => {
  open(commands(vi.fn()));

  expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  expect(screen.getByText('Go to List')).toBeInTheDocument();
  expect(screen.getByText('Refresh data')).toBeInTheDocument();
  expect(screen.getByText('Detail reading')).toBeInTheDocument();
});

test('filters actions and tickets by the typed query', () => {
  open(commands(vi.fn()));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bza-9xy' } });

  expect(screen.getByText('Detail reading')).toBeInTheDocument();
  expect(screen.queryByText('Go to List')).not.toBeInTheDocument();
});

test('runs the selected command and closes', () => {
  const run = vi.fn();
  const onClose = open(commands(run));

  screen.getByText('Refresh data').click();

  expect(run).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalled();
});

test('escape closes the palette', () => {
  const onClose = open(commands(vi.fn()));

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  expect(onClose).toHaveBeenCalled();
});

test('shows the empty state when nothing matches', () => {
  open(commands(vi.fn()));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz-no-match' } });

  expect(screen.getByText('No matching commands')).toBeInTheDocument();
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});

test('renders at most 50 results', () => {
  const items: CommandItem[] = Array.from({ length: 1200 }, (_, index) => ({
    id: `action:${index}`,
    title: `Keyboard action ${index}`,
    group: 'Actions',
    run: () => undefined,
  }));
  open(items);

  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'keyboard' } });

  expect(screen.getAllByRole('option')).toHaveLength(50);
});

test('follows the active language', () => {
  renderWithI18n(<CommandPalette commands={commands(vi.fn())} onClose={vi.fn()} />, 'zh-CN');

  expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('搜索命令与票')).toBeInTheDocument();
});
