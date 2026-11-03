import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { PopoverSelect } from './popover-select';

const OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'closed', label: 'Closed' },
];

test('choosing an option updates the trigger and closes the menu', () => {
  const onChange = vi.fn();
  render(<PopoverSelect label="Status" value="open" options={OPTIONS} onChange={onChange} />);
  const details = document.querySelector('details');
  if (details === null) {
    throw new Error('no menu');
  }
  details.open = true;

  fireEvent.click(screen.getByRole('radio', { name: 'In progress' }));

  expect(onChange).toHaveBeenCalledWith('in_progress');
  expect(details.open).toBe(false);
  expect(screen.getByLabelText('Status: In progress')).toBeInTheDocument();
});

test('Escape closes the menu without reaching the shell', () => {
  render(<PopoverSelect label="Status" value="open" options={OPTIONS} onChange={vi.fn()} />);
  const details = document.querySelector('details');
  if (details === null) {
    throw new Error('no menu');
  }
  details.open = true;
  const shellListener = vi.fn();
  window.addEventListener('keydown', shellListener);

  fireEvent.keyDown(screen.getByLabelText('Status: Open'), { key: 'Escape' });

  expect(details.open).toBe(false);
  // The shell binds Escape on window (back to list); a dismissed menu must not
  // also navigate the page behind it.
  expect(shellListener).not.toHaveBeenCalled();
  window.removeEventListener('keydown', shellListener);
});

test('a disabled select cannot be opened or focused', () => {
  render(
    <PopoverSelect label="Status" value="open" options={OPTIONS} onChange={vi.fn()} disabled />
  );
  const details = document.querySelector('details');
  if (details === null) {
    throw new Error('no menu');
  }
  details.open = true;

  const summary = screen.getByLabelText('Status: Open');
  expect(summary).toHaveAttribute('aria-disabled', 'true');
  expect(summary).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('radio', { name: 'Open' })).toBeDisabled();
});
