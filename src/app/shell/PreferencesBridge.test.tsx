import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { WorkspaceSnapshot } from '@/bindings/bd';
import { I18nProvider, useI18n } from '@/lib/i18n/I18nProvider';
import { ThemeProvider, useTheme } from '@/lib/theme/ThemeProvider';
import type { UseWorkspace } from '@/lib/workspace/useWorkspace';

import {
  PreferencesBridge,
  usePreferenceWriteError,
  type PreferencesApi,
} from './PreferencesBridge';
import { WorkspaceProvider } from './WorkspaceProvider';

function snapshot(language: 'en' | 'zh-CN', theme: 'light' | 'dark' | 'system'): WorkspaceSnapshot {
  return {
    config: {
      schemaVersion: 1,
      bdPath: null,
      language,
      theme,
      lastWorkspacePath: null,
      workspaces: [],
    },
    missing: [],
    active: null,
    corruptBackup: null,
  };
}

/** Only `snapshot` is read by the bridge; the rest of the hook is inert here. */
function workspaceWith(value: WorkspaceSnapshot): UseWorkspace {
  return {
    snapshot: value,
    bd: null,
    loading: false,
    error: null,
    reload: vi.fn(),
    refreshBd: vi.fn(),
    add: vi.fn(),
    switchTo: vi.fn(),
    remove: vi.fn(),
    relocate: vi.fn(),
    setBdPath: vi.fn(),
  };
}

function Controls() {
  const { language, setLanguage } = useI18n();
  const { preference, setPreference } = useTheme();
  const error = usePreferenceWriteError();
  return (
    <div>
      <span>language:{language}</span>
      <span>theme:{preference}</span>
      <span>error:{error ?? '-'}</span>
      <button type="button" onClick={() => setLanguage('zh-CN')}>
        zh
      </button>
      <button type="button" onClick={() => setPreference('dark')}>
        dark
      </button>
    </div>
  );
}

function renderBridge(
  value: WorkspaceSnapshot,
  api: PreferencesApi,
  {
    language = 'en',
    theme = 'system',
  }: { language?: 'en' | 'zh-CN'; theme?: 'light' | 'dark' | 'system' } = {}
) {
  return render(
    <I18nProvider initialLanguage={language}>
      <ThemeProvider initialPreference={theme}>
        <WorkspaceProvider workspace={workspaceWith(value)}>
          <PreferencesBridge api={api}>
            <Controls />
          </PreferencesBridge>
        </WorkspaceProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

test('the registry snapshot overrides the cached language and theme', async () => {
  const api = { setPreferences: vi.fn(async () => undefined) };
  renderBridge(snapshot('zh-CN', 'dark'), api);

  await waitFor(() => expect(screen.getByText('language:zh-CN')).toBeInTheDocument());
  expect(screen.getByText('theme:dark')).toBeInTheDocument();
  expect(api.setPreferences).not.toHaveBeenCalled();
});

test('a change after hydration is written once with the whole pair', async () => {
  const api = { setPreferences: vi.fn(async () => undefined) };
  renderBridge(snapshot('en', 'system'), api);
  await waitFor(() => expect(screen.getByText('language:en')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'dark' }));

  await waitFor(() => expect(api.setPreferences).toHaveBeenCalledWith('en', 'dark'));
  expect(api.setPreferences).toHaveBeenCalledTimes(1);
});

test('two quick changes each write once and the last pair wins', async () => {
  const api = { setPreferences: vi.fn(async () => undefined) };
  renderBridge(snapshot('en', 'system'), api);
  await waitFor(() => expect(screen.getByText('language:en')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'zh' }));
  fireEvent.click(screen.getByRole('button', { name: 'dark' }));

  await waitFor(() => expect(api.setPreferences).toHaveBeenCalledWith('zh-CN', 'dark'));
  expect(api.setPreferences).toHaveBeenCalledTimes(2);
});

test('a failed write stays visible while the choice keeps working', async () => {
  const api = {
    setPreferences: vi.fn(async () => {
      throw new Error('config is read-only');
    }),
  };
  renderBridge(snapshot('en', 'system'), api);
  await waitFor(() => expect(screen.getByText('language:en')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'zh' }));

  await waitFor(() => expect(screen.getByText('error:config is read-only')).toBeInTheDocument());
  expect(screen.getByText('language:zh-CN')).toBeInTheDocument();
});
