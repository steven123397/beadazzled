import { expect, test } from 'vitest';

import type { Issue } from '@/bindings/bd';

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

test('ranks 1200 candidates in under 50ms', () => {
  const issues = Array.from({ length: 1000 }, (_, index) =>
    issue(`bza-${index}`, `Issue number ${index} about routers and keyboards`)
  );
  const commands = buildCommands(issues, context());
  // Pad the action group to 200 entries, the size the palette is budgeted for.
  for (let index = 0; index < 195; index += 1) {
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
