import { render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';

import type { Issue } from '@/bindings/bd';
import type { Language } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/I18nProvider';

export const TEST_TS = '2026-11-01T00:00:00Z';

export function makeIssue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: TEST_TS,
    updated_at: TEST_TS,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

export function renderWithI18n(ui: ReactElement, initialLanguage: Language = 'en') {
  return render(createElement(I18nProvider, { initialLanguage, children: ui }));
}
