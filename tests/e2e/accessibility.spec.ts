import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { installFakeBridge } from './fakeBridge';

// Four routes plus two overlays of axe analysis need more than the default 30s.
test.setTimeout(60_000);

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();

  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`);
}

test('shell routes have no serious or critical accessibility violations', async ({ page }) => {
  await installFakeBridge(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/#/w/p1/board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/#/w/missing/list');
  await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the palette and help overlays have no serious or critical violations', async ({ page }) => {
  await installFakeBridge(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();

  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the dark theme has no serious or critical violations', async ({ page }) => {
  await installFakeBridge(page, {
    theme: 'dark',
    syncState: { kind: 'healthy', lastSeq: 1, lastEventAt: null },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);

  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the dark warning tone has no serious or critical violations', async ({ page }) => {
  await installFakeBridge(page, {
    theme: 'dark',
    syncState: { kind: 'journal-disabled' },
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();
  await expect(page.getByLabel('Status bar')).toContainText('Journal off');

  expect(await seriousViolations(page)).toEqual([]);
});

test('the detail reading page has no serious or critical violations', async ({ page }) => {
  const TS = '2026-11-01T00:00:00Z';
  await installFakeBridge(page, {
    issues: [
      {
        id: 'bza-a',
        title: 'Blocker',
        description: '',
        status: 'closed',
        priority: 1,
        issue_type: 'task',
        created_at: TS,
        updated_at: TS,
        labels: [],
        dependency_count: 0,
        dependent_count: 1,
        comment_count: 0,
      },
      {
        id: 'bza-b',
        title: 'Document reading',
        description: [
          '## Notes',
          '',
          'A **bold** paragraph with `code`.',
          '',
          '| Name | State |',
          '| --- | --- |',
          '| beta | open |',
          '',
          '- [x] shipped',
        ].join('\n'),
        acceptance_criteria: '- [x] ships',
        status: 'open',
        priority: 2,
        issue_type: 'task',
        assignee: 'ada',
        created_at: TS,
        updated_at: TS,
        labels: ['ui'],
        dependencies: [
          { issue_id: 'bza-b', depends_on_id: 'bza-a', type: 'blocks', created_at: TS },
        ],
        comments: [
          { id: 'c1', issue_id: 'bza-b', author: 'lin', text: 'Looks good', created_at: TS },
        ],
        dependency_count: 1,
        dependent_count: 0,
        comment_count: 1,
      },
    ],
  });

  await page.goto('/#/w/p1/issue/bza-b');
  await expect(page.getByRole('heading', { name: 'Document reading' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Blocked by' })).toBeVisible();

  expect(await seriousViolations(page)).toEqual([]);
});
