import { fireEvent, render, screen } from '@testing-library/react';
import { MoreHorizontal } from 'lucide-react';
import { expect, test, vi } from 'vitest';

import { Menu } from './menu';

function renderMenu(overrides: Partial<React.ComponentProps<typeof Menu>> = {}) {
  const onSelect = vi.fn();
  const onOther = vi.fn();
  render(
    <Menu
      label="Actions"
      trigger={<MoreHorizontal />}
      items={[
        { id: 'copy', label: 'Copy id', onSelect },
        { id: 'disabled', label: 'Unavailable', onSelect: vi.fn(), disabled: true },
        { id: 'other', label: 'Other', onSelect: onOther },
      ]}
      {...overrides}
    />
  );
  return { onSelect, onOther };
}

test('the menu opens from the trigger and focuses its first item', () => {
  renderMenu();

  const trigger = screen.getByRole('button', { name: 'Actions' });
  fireEvent.click(trigger);

  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Copy id' })).toHaveFocus();
});

test('arrow keys move between enabled items and wrap', () => {
  renderMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Other' })).toHaveFocus();

  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: 'Copy id' })).toHaveFocus();

  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(screen.getByRole('menuitem', { name: 'Other' })).toHaveFocus();
});

test('escape closes the menu and returns focus to the trigger', () => {
  renderMenu();
  const trigger = screen.getByRole('button', { name: 'Actions' });
  fireEvent.click(trigger);

  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});

test('choosing an item runs its action and closes the menu', () => {
  const { onOther } = renderMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

  fireEvent.click(screen.getByRole('menuitem', { name: 'Other' }));

  expect(onOther).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('a press outside closes the menu without stealing focus', () => {
  renderMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

  fireEvent.pointerDown(document.body);

  expect(screen.queryByRole('menu')).toBeNull();
});
