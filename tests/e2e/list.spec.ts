import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog } from './fakeBridge';

function issue(index: number) {
  return {
    id: `bza-${index}`,
    title: `Issue ${index}`,
    description: '',
    status: index % 7 === 0 ? 'closed' : index % 5 === 0 ? 'in_progress' : 'open',
    priority: index % 5,
    issue_type: index % 3 === 0 ? 'bug' : 'task',
    assignee: index % 4 === 0 ? 'ada' : index % 4 === 1 ? 'lin' : undefined,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    labels: index % 2 === 0 ? ['ui'] : ['backend', 'perf', 'docs'],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
  };
}

async function openThousandIssueList(page: import('@playwright/test').Page): Promise<void> {
  await installFakeBridge(page, {
    issues: Array.from({ length: 1000 }, (_, index) => issue(index)),
  });
  await page.goto('/#/w/p1/list');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();
}

test('a 1000-issue list virtualizes, navigates with J/K and restores focus', async ({ page }) => {
  test.setTimeout(60_000);
  await openThousandIssueList(page);

  const rows = page.getByRole('listitem');
  expect(await rows.count()).toBeLessThan(100);

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('j');
  }

  const focused = page.locator('[data-focused="true"]');
  await expect(focused).toHaveAttribute('data-issue-id', 'bza-19');
  await expect(focused).toBeFocused();

  const list = page.getByRole('list', { name: 'Issues' });
  const scrollBefore = await list.evaluate((element) => element.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/w\/p1\/issue\/bza-19$/);
  await expect(page.getByRole('heading', { name: /bza-19/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/w\/p1\/list$/);
  await expect(page.locator('[data-issue-id="bza-19"]')).toBeFocused();

  const scrollAfter = await page
    .getByRole('list', { name: 'Issues' })
    .evaluate((element) => element.scrollTop);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);

  await page.getByRole('list', { name: 'Issues' }).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('[data-issue-id="bza-999"]')).toBeVisible();
  expect(await page.locator('[data-issue-id]').count()).toBeLessThan(100);
});

test('typing a multi-word query keeps its spaces', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [
      { ...issue(1), title: 'Fix scroll' },
      { ...issue(2), title: 'Fix board' },
    ],
  });
  await page.goto('/#/w/p1/list');

  const search = page.getByRole('searchbox', { name: 'Search tickets' });
  await search.click();
  // A controlled input echoes every keystroke through the URL; trimming the
  // query there would drop the space before the next character arrives.
  await search.pressSequentially('fix scroll', { delay: 20 });

  await expect(search).toHaveValue('fix scroll');
  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-2"]')).toHaveCount(0);
});

test('filtering, sorting, scrolling and grouping never call bd', async ({ page }) => {
  test.setTimeout(60_000);
  await openThousandIssueList(page);
  await clearInvokeLog(page);

  const search = page.getByRole('searchbox', { name: 'Search tickets' });
  await search.fill('Issue 1');
  await expect(page.locator('output')).toHaveText(/\d+ \/ 1000/);

  await page.getByRole('combobox', { name: 'Sort by' }).selectOption('priority');
  await page.getByRole('combobox', { name: 'Group by' }).selectOption('status');
  const openGroup = page.getByRole('button', { name: /^Open/ });
  await expect(openGroup).toBeVisible();
  await openGroup.click();

  await page.getByRole('list', { name: 'Issues' }).evaluate((element) => {
    element.scrollTop += 800;
  });
  await expect(page.locator('[data-issue-id]').first()).toBeVisible();

  // The whole list is derived in memory: no filter, sort, scroll or group
  // toggle may reach the bridge.
  expect(await invokeLog(page)).toEqual([]);
});
