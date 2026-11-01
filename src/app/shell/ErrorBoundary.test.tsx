import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('render exploded');
}

test('catches a render error and shows the message instead of a blank window', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>
  );

  expect(screen.getByRole('alert')).toHaveTextContent('render exploded');
  expect(screen.getByRole('button', { name: /copy diagnostics/i })).toBeInTheDocument();
});

test('renders children when nothing throws', () => {
  render(
    <ErrorBoundary>
      <p>all good</p>
    </ErrorBoundary>
  );

  expect(screen.getByText('all good')).toBeInTheDocument();
});
