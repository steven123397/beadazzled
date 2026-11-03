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

test('changing the language applies immediately', () => {
  renderSection();

  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'zh-CN' } });

  expect(screen.getByLabelText('语言')).toHaveValue('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
});

test('changing the theme applies immediately', () => {
  renderSection();

  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });

  expect(document.documentElement.classList.contains('dark')).toBe(true);
});
