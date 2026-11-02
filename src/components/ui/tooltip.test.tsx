import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { Tooltip } from './tooltip';

afterEach(() => {
  vi.useRealTimers();
});

test('the hint appears after the delay on hover and hides on leave', () => {
  vi.useFakeTimers();
  render(
    <Tooltip label="Collapse sidebar">
      <button type="button">Trigger</button>
    </Tooltip>
  );
  const wrapper = screen.getByRole('button', { name: 'Trigger' }).parentElement!;

  fireEvent.mouseEnter(wrapper);
  expect(screen.queryByRole('tooltip')).toBeNull();

  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(screen.getByRole('tooltip')).toHaveTextContent('Collapse sidebar');

  fireEvent.mouseLeave(wrapper);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('focus shows the hint and wires aria-describedby to it', () => {
  vi.useFakeTimers();
  render(
    <Tooltip label="Collapse sidebar" delayMs={0}>
      <button type="button">Trigger</button>
    </Tooltip>
  );
  const wrapper = screen.getByRole('button', { name: 'Trigger' }).parentElement!;

  fireEvent.focus(wrapper);
  act(() => {
    vi.advanceTimersByTime(0);
  });

  const tooltip = screen.getByRole('tooltip');
  expect(tooltip.id).not.toBe('');
  expect(screen.getByRole('button', { name: 'Trigger' })).toHaveAttribute(
    'aria-describedby',
    tooltip.id
  );
});

test('escape dismisses the hint', () => {
  vi.useFakeTimers();
  render(
    <Tooltip label="Collapse sidebar" delayMs={0}>
      <button type="button">Trigger</button>
    </Tooltip>
  );
  const wrapper = screen.getByRole('button', { name: 'Trigger' }).parentElement!;

  fireEvent.focus(wrapper);
  act(() => {
    vi.advanceTimersByTime(0);
  });
  expect(screen.getByRole('tooltip')).toBeInTheDocument();

  fireEvent.keyDown(wrapper, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
});
