import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n/I18nProvider';

import { AboutSection } from './AboutSection';

const getVersion = vi.fn();

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => getVersion(),
}));

vi.mock('@/lib/links', () => ({
  openExternal: vi.fn(async () => undefined),
}));

function renderSection() {
  return render(
    <I18nProvider initialLanguage="en">
      <AboutSection />
    </I18nProvider>
  );
}

test('the app version comes from the runtime', async () => {
  getVersion.mockResolvedValue('0.1.0');
  renderSection();

  expect(await screen.findByText('Version 0.1.0')).toBeInTheDocument();
  expect(screen.getByText('MIT license')).toBeInTheDocument();
});

test('the update check is shown disabled until the updater ships', () => {
  getVersion.mockResolvedValue('0.1.0');
  renderSection();

  const button = screen.getByRole('button', { name: 'Check for updates' });
  expect(button).toBeDisabled();
  expect(
    screen.getByText(
      'Automatic updates arrive with the release build; this button stays off until then.'
    )
  ).toBeInTheDocument();
});

test('a webview without the app plugin omits the version row', async () => {
  getVersion.mockRejectedValue(new Error('plugin:app not available'));
  renderSection();

  await waitFor(() => expect(screen.getByText('MIT license')).toBeInTheDocument());
  expect(screen.queryByText(/^Version /)).not.toBeInTheDocument();
});
