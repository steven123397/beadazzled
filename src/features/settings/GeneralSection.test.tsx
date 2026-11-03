import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';

import { GeneralSection } from './GeneralSection';
import './messages';

function renderSection() {
  return render(
    <I18nProvider initialLanguage="en">
      <ThemeProvider initialPreference="system">
        <GeneralSection />
      </ThemeProvider>
    </I18nProvider>
  );
}

function choose(trigger: string, option: string): void {
  const details = screen.getByLabelText(trigger).closest('details');
  if (details !== null) {
    details.open = true;
  }
  fireEvent.click(screen.getByRole('radio', { name: option }));
}

test('changing the language applies immediately', () => {
  renderSection();

  choose('Language: English', '中文');

  expect(screen.getByLabelText('语言: 中文')).toBeInTheDocument();
  expect(document.documentElement.lang).toBe('zh-CN');
});

test('changing the theme applies immediately', () => {
  renderSection();

  choose('Theme: System', 'Dark');

  expect(screen.getByLabelText('Theme: Dark')).toBeInTheDocument();
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});
