import { expect, test } from 'vitest';

import type { WorkspaceEntry } from '@/bindings/bd';

import { findWorkspace, recentWorkspaces, workspaceKey } from './recent';

function entry(path: string, openedAt: string): WorkspaceEntry {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    projectId: `project-${path}`,
    isWorktree: false,
    lastOpenedAt: openedAt,
    checkpoint: null,
  };
}

const older = entry('D:/work/alpha', '2026-10-30T09:00:00Z');
const newer = entry('D:/work/beta', '2026-11-01T09:00:00Z');
const middle = entry('D:/work/gamma', '2026-10-31T09:00:00Z');

test('orders workspaces by most recently opened', () => {
  const ordered = recentWorkspaces([older, newer, middle]);

  expect(ordered.map((workspace) => workspace.path)).toEqual([
    'D:/work/beta',
    'D:/work/gamma',
    'D:/work/alpha',
  ]);
});

test('does not mutate the input list', () => {
  const input = [older, newer, middle];

  recentWorkspaces(input);

  expect(input).toEqual([older, newer, middle]);
});

test('limits the recent list', () => {
  const ordered = recentWorkspaces([older, newer, middle], 2);

  expect(ordered.map((workspace) => workspace.path)).toEqual(['D:/work/beta', 'D:/work/gamma']);
});

test('treats a missing timestamp as the oldest entry', () => {
  const unknown = { ...entry('D:/work/unknown', ''), lastOpenedAt: '' };

  const ordered = recentWorkspaces([unknown, older]);

  expect(ordered.map((workspace) => workspace.path)).toEqual(['D:/work/alpha', 'D:/work/unknown']);
});

test('uses the shared numeric collator to break timestamp ties', () => {
  const ten = entry('D:/work/BZA-10', older.lastOpenedAt);
  const two = entry('D:/work/BZA-2', older.lastOpenedAt);

  expect(recentWorkspaces([ten, two]).map((workspace) => workspace.path)).toEqual([
    'D:/work/BZA-2',
    'D:/work/BZA-10',
  ]);
});

test('finds a workspace through a differently spelled path', () => {
  const workspaces = [older, newer];

  expect(findWorkspace(workspaces, 'd:\\work\\beta\\')?.path).toBe('D:/work/beta');
});

test('normalises separators, trailing slashes and case', () => {
  expect(workspaceKey('D:\\Work\\Beta\\')).toBe(workspaceKey('d:/work/beta'));
  expect(workspaceKey('D:/work/beta')).toBe('d:/work/beta');
});
