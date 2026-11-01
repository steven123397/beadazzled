import { act, fireEvent, render, screen } from '@testing-library/react';
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

function stubSystemListener(prefersDark: boolean): (matches: boolean) => void {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;
  window.matchMedia = ((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => {
      listener = callback;
    },
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return (matches: boolean) => listener?.({ matches } as MediaQueryListEvent);
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

test('system preference follows a media-query change', () => {
  const emit = stubSystemListener(false);

  render(
    <ThemeProvider initialPreference="system">
      <Probe />
    </ThemeProvider>
  );
  expect(screen.getByTestId('resolved')).toHaveTextContent('light');

  act(() => emit(true));

  expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

test('restores the persisted preference when no initial value is passed', () => {
  localStorage.setItem('beadazzled.theme', 'dark');

  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );

  expect(screen.getByTestId('preference')).toHaveTextContent('dark');
  expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});
