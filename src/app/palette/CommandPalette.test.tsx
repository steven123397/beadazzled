import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/I18nProvider';

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
  render(
    <I18nProvider initialLanguage="en">
      <CommandPalette commands={items} onClose={onClose} />
    </I18nProvider>
  );
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

test('renders at most 50 results and stays inside the 50ms input-to-result budget', () => {
  const items: CommandItem[] = Array.from({ length: 1200 }, (_, index) => ({
    id: `action:${index}`,
    title: `Keyboard action ${index}`,
    group: 'Actions',
    run: () => undefined,
  }));
  open(items);

  const input = screen.getByRole('combobox');
  const started = performance.now();
  fireEvent.change(input, { target: { value: 'keyboard' } });
  const elapsed = performance.now() - started;

  expect(screen.getAllByRole('option')).toHaveLength(50);
  expect(elapsed).toBeLessThan(50);
});

test('follows the active language', () => {
  render(
    <I18nProvider initialLanguage="zh-CN">
      <CommandPalette commands={commands(vi.fn())} onClose={vi.fn()} />
    </I18nProvider>
  );

  expect(screen.getByRole('dialog', { name: '命令面板' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('搜索命令与票')).toBeInTheDocument();
});
