import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { ThemeProvider, useTheme } from './ThemeProvider';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.documentElement.classList.remove('dark');
  localStorage.clear();
});

function stubSystem(prefersDark: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function Probe() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setPreference('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setPreference('light')}>
        light
      </button>
    </div>
  );
}

test('system preference follows the media query', () => {
  stubSystem(true);

  render(
    <ThemeProvider initialPreference="system">
      <Probe />
    </ThemeProvider>
  );

  expect(screen.getByTestId('preference')).toHaveTextContent('system');
  expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('an explicit choice applies immediately and persists', () => {
  stubSystem(true);

  render(
    <ThemeProvider initialPreference="system">
      <Probe />
    </ThemeProvider>
  );

  fireEvent.click(screen.getByRole('button', { name: 'light' }));

  expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(localStorage.getItem('beadazzled.theme')).toBe('light');
});
