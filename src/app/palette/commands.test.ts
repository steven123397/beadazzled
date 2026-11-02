import { expect, test, vi } from 'vitest';

import type { Issue } from '@/bindings/bd';
import { translate } from '@/lib/i18n';

import { buildCommands, rankCommands, type PaletteContext } from './commands';

function issue(id: string, title: string, extra: Partial<Issue> = {}): Issue {
  return {
    id,
    title,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...extra,
  };
}

function context(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    navigate: () => undefined,
    refresh: () => undefined,
    copyDiagnostics: () => undefined,
    project: { projectId: 'p1' },
    t: (key, vars) => translate('en', key, vars),
    theme: 'system',
    setTheme: () => undefined,
    language: 'en',
    setLanguage: () => undefined,
    ...overrides,
  };
}

test('builds navigation, actions and issue commands', () => {
  const commands = buildCommands([issue('bza-1', 'Fix the shell')], context());

  expect(commands.map((command) => command.group)).toContain('Navigation');
  expect(commands.map((command) => command.group)).toContain('Actions');
  expect(commands.find((command) => command.id === 'issue:bza-1')?.title).toBe('Fix the shell');
});

test('skips view navigation when no workspace is open', () => {
  const commands = buildCommands([], context({ project: null }));

  expect(commands.some((command) => command.id === 'nav:list')).toBe(false);
  expect(commands.some((command) => command.id === 'nav:settings')).toBe(true);
});

test('ranks exact prefixes ahead of loose matches', () => {
  const commands = buildCommands(
    [issue('bza-1', 'Board polish'), issue('bza-2', 'Improve board keyboard')],
    context()
  );
  const ranked = rankCommands(commands, 'board');

  expect(ranked[0]?.title).toBe('Board polish');
});

test('matches issue ids', () => {
  const commands = buildCommands([issue('bza-9xy', 'Detail reading')], context());

  expect(rankCommands(commands, 'bza-9xy')[0]?.id).toBe('issue:bza-9xy');
});

test('an empty query returns the list unchanged', () => {
  const commands = buildCommands([issue('bza-1', 'One')], context());

  expect(rankCommands(commands, '  ')).toHaveLength(commands.length);
});

test('the theme action cycles to the next preference', () => {
  const setTheme = vi.fn();
  const commands = buildCommands([], context({ setTheme }));

  commands.find((command) => command.id === 'action:theme')?.run();

  expect(setTheme).toHaveBeenCalledWith('light');
});

test('the language action switches to the other catalog', () => {
  const setLanguage = vi.fn();
  const commands = buildCommands([], context({ setLanguage }));

  commands.find((command) => command.id === 'action:language')?.run();

  expect(setLanguage).toHaveBeenCalledWith('zh-CN');
});

test('the language action cycles back from zh-CN to en', () => {
  const setLanguage = vi.fn();
  const commands = buildCommands([], context({ language: 'zh-CN', setLanguage }));

  commands.find((command) => command.id === 'action:language')?.run();

  expect(setLanguage).toHaveBeenCalledWith('en');
});

test('rankCommands caps the result set', () => {
  const commands = Array.from({ length: 60 }, (_, index) => ({
    id: `action:${index}`,
    title: `Matching action ${index}`,
    group: 'Actions' as const,
    run: () => undefined,
  }));

  const ranked = rankCommands(commands, 'matching', 50);

  expect(ranked).toHaveLength(50);
  expect(ranked[0]?.id).toBe('action:0');
});

test('command titles follow the active language', () => {
  const commands = buildCommands([], context({ t: (key, vars) => translate('zh-CN', key, vars) }));

  expect(commands.find((command) => command.id === 'nav:settings')?.title).toBe('前往设置');
});

test('ranks 1200 candidates in under 50ms', () => {
  const issues = Array.from({ length: 1000 }, (_, index) =>
    issue(`bza-${index}`, `Issue number ${index} about routers and keyboards`)
  );
  const commands = buildCommands(issues, context());
  // Pad the action group to 200 entries, the size the palette is budgeted for.
  for (let index = 0; commands.length < 1200; index += 1) {
    commands.push({
      id: `action:extra-${index}`,
      title: `Extra action ${index}`,
      group: 'Actions',
      keywords: 'maintenance',
      run: () => undefined,
    });
  }
  expect(commands).toHaveLength(1200);

  const started = performance.now();
  for (let run = 0; run < 10; run += 1) {
    rankCommands(commands, 'keyboard');
  }
  const elapsed = (performance.now() - started) / 10;

  expect(elapsed).toBeLessThan(50);
});

test('builds no issue commands while no workspace is open', () => {
  const navigate = vi.fn();
  const commands = buildCommands([issue('bza-1', 'Fix the shell')], context({ project: null, navigate }));

  expect(commands.some((command) => command.group === 'Issues')).toBe(false);
  expect(commands.some((command) => command.id === 'issue:bza-1')).toBe(false);

  // Workspace-independent actions still work; nothing routes into a project.
  commands.forEach((command) => command.run());
  expect(navigate).not.toHaveBeenCalledWith(expect.stringContaining('/w/'));
});
