import { expect, test } from 'vitest';

import { createWorkspaceApi } from './api';

test('every workspace action maps to its tauri command and arguments', async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const api = createWorkspaceApi(async (command, args) => {
    calls.push([command, args]);
    return undefined as never;
  });

  await api.snapshot();
  await api.bdStatus();
  await api.bdStatus(true);
  await api.setBdPath('C:/tools/bd.exe');
  await api.setBdPath(null);
  await api.setPreferences('zh-CN', 'dark');
  await api.add('D:/repo');
  await api.switchTo('D:/repo');
  await api.remove('D:/repo');
  await api.relocate('D:/old', 'D:/new');
  await api.setCheckpoint('D:/repo', 42);
  await api.checkpoint('D:/repo', 'project-1');
  await api.flush();

  expect(calls).toEqual([
    ['workspace_snapshot', undefined],
    ['bd_status', { refresh: false }],
    ['bd_status', { refresh: true }],
    ['bd_set_path', { path: 'C:/tools/bd.exe' }],
    ['bd_set_path', { path: null }],
    ['app_set_preferences', { language: 'zh-CN', theme: 'dark' }],
    ['workspace_add', { path: 'D:/repo' }],
    ['workspace_switch', { path: 'D:/repo' }],
    ['workspace_remove', { path: 'D:/repo' }],
    ['workspace_relocate', { oldPath: 'D:/old', newPath: 'D:/new' }],
    ['workspace_set_checkpoint', { path: 'D:/repo', seq: 42 }],
    ['workspace_checkpoint', { path: 'D:/repo', projectId: 'project-1' }],
    ['workspace_flush', undefined],
  ]);
});