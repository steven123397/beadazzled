import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

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

test('opens as a dialog with every command', () => {
  render(<CommandPalette commands={commands(vi.fn())} onClose={vi.fn()} />);

  expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  expect(screen.getByText('Go to List')).toBeInTheDocument();
  expect(screen.getByText('Refresh data')).toBeInTheDocument();
  expect(screen.getByText('Detail reading')).toBeInTheDocument();
});

test('filters actions and tickets by the typed query', () => {
  render(<CommandPalette commands={commands(vi.fn())} onClose={vi.fn()} />);

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bza-9xy' } });

  expect(screen.getByText('Detail reading')).toBeInTheDocument();
  expect(screen.queryByText('Go to List')).not.toBeInTheDocument();
});

test('runs the selected command and closes', () => {
  const run = vi.fn();
  const onClose = vi.fn();
  render(<CommandPalette commands={commands(run)} onClose={onClose} />);

  screen.getByText('Refresh data').click();

  expect(run).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalled();
});

test('escape closes the palette', () => {
  const onClose = vi.fn();
  render(<CommandPalette commands={commands(vi.fn())} onClose={onClose} />);

  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

  expect(onClose).toHaveBeenCalled();
});
