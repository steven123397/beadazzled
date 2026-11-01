import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { I18nProvider, useI18n } from './I18nProvider';

afterEach(() => {
  document.documentElement.lang = 'en';
});

function Probe() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="label">{t('nav.list')}</span>
      <button type="button" onClick={() => setLanguage('zh-CN')}>
        zh
      </button>
    </div>
  );
}

test('starts in English and switches instantly', () => {
  render(
    <I18nProvider initialLanguage="en">
      <Probe />
    </I18nProvider>
  );

  expect(screen.getByTestId('label')).toHaveTextContent('List');

  fireEvent.click(screen.getByRole('button', { name: 'zh' }));

  expect(screen.getByTestId('language')).toHaveTextContent('zh-CN');
  expect(screen.getByTestId('label')).toHaveTextContent('列表');
  expect(localStorage.getItem('beadazzled.language')).toBe('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
});

test('restores the stored language', () => {
  localStorage.setItem('beadazzled.language', 'zh-CN');

  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>
  );

  expect(screen.getByTestId('label')).toHaveTextContent('列表');
});
