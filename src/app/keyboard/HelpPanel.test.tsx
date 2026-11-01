import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { Shortcut } from './types';
import { HelpPanel } from './HelpPanel';

const shortcuts: Shortcut[] = [
  {
    id: 'palette',
    keys: 'mod+k',
    label: 'Command palette',
    group: 'General',
    run: vi.fn(),
  },
  {
    id: 'go-list',
    keys: ['g', 'l'],
    label: 'Go to List',
    group: 'Navigation',
    run: vi.fn(),
  },
];

test('lists every registered shortcut with a readable key', () => {
  render(<HelpPanel shortcuts={shortcuts} onClose={vi.fn()} />);

  expect(screen.getByRole('dialog', { name: /keyboard/i })).toBeInTheDocument();
  expect(screen.getByText('Command palette')).toBeInTheDocument();
  expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
  expect(screen.getByText('G then L')).toBeInTheDocument();
});

test('groups shortcuts by their registered group', () => {
  render(<HelpPanel shortcuts={shortcuts} onClose={vi.fn()} />);

  expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
});

test('closing the panel calls onClose', () => {
  const onClose = vi.fn();
  render(<HelpPanel shortcuts={shortcuts} onClose={onClose} />);

  screen.getByRole('button', { name: /close/i }).click();

  expect(onClose).toHaveBeenCalled();
});
