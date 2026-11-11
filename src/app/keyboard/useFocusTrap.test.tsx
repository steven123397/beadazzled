import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';
import { expect, test } from 'vitest';

import { useFocusTrap } from './useFocusTrap';

function FocusTrap({
  label,
  onEscape = () => undefined,
  children,
}: {
  label: string;
  onEscape?: () => void;
  children?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  useFocusTrap(container);

  return (
    <div
      ref={container}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onEscape();
        }
      }}
    >
      {children}
    </div>
  );
}

function NestedTraps() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);

  return (
    <>
      <button onClick={() => setParentOpen(true)}>Open parent</button>
      {parentOpen ? (
        <FocusTrap label="Parent" onEscape={() => setParentOpen(false)}>
          <button>Parent first</button>
          <button onClick={() => setChildOpen(true)}>Open child</button>
          <button>Parent last</button>
        </FocusTrap>
      ) : null}
      {childOpen ? (
        <FocusTrap label="Child" onEscape={() => setChildOpen(false)}>
          <button>Child first</button>
          <button>Child last</button>
        </FocusTrap>
      ) : null}
    </>
  );
}

test('the topmost trap owns Tab and Escape restores focus through nested modals', () => {
  render(<NestedTraps />);
  const opener = screen.getByRole('button', { name: 'Open parent' });
  opener.focus();
  fireEvent.click(opener);

  const parentFirst = screen.getByRole('button', { name: 'Parent first' });
  const parentLast = screen.getByRole('button', { name: 'Parent last' });
  const openChild = screen.getByRole('button', { name: 'Open child' });
  expect(parentFirst).toHaveFocus();

  parentLast.focus();
  fireEvent.keyDown(parentLast, { key: 'Tab' });
  expect(parentFirst).toHaveFocus();
  fireEvent.keyDown(parentFirst, { key: 'Tab', shiftKey: true });
  expect(parentLast).toHaveFocus();

  openChild.focus();
  fireEvent.click(openChild);
  const childFirst = screen.getByRole('button', { name: 'Child first' });
  const childLast = screen.getByRole('button', { name: 'Child last' });
  expect(childFirst).toHaveFocus();

  childLast.focus();
  fireEvent.keyDown(childLast, { key: 'Tab' });
  expect(childFirst).toHaveFocus();
  fireEvent.keyDown(childFirst, { key: 'Tab', shiftKey: true });
  expect(childLast).toHaveFocus();

  expect(fireEvent.keyDown(childLast, { key: 'Escape' })).toBe(true);
  expect(screen.queryByRole('dialog', { name: 'Child' })).not.toBeInTheDocument();
  expect(openChild).toHaveFocus();

  fireEvent.keyDown(openChild, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Parent' })).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

function EmptyTrap({ open }: { open: boolean }) {
  return (
    <>
      <button>Outside</button>
      {open ? <FocusTrap label="Empty" /> : null}
    </>
  );
}

test('a trap without focusable children keeps Tab on its container and restores focus', () => {
  const { rerender } = render(<EmptyTrap open={false} />);
  const outside = screen.getByRole('button', { name: 'Outside' });
  outside.focus();

  rerender(<EmptyTrap open />);
  const dialog = screen.getByRole('dialog', { name: 'Empty' });
  expect(dialog).toHaveFocus();

  expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
  expect(dialog).toHaveFocus();

  rerender(<EmptyTrap open={false} />);
  expect(outside).toHaveFocus();
});
