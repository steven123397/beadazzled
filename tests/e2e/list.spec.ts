import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog, makeIssue, makeIssues } from './fakeBridge';

async function openThousandIssueList(page: import('@playwright/test').Page): Promise<void> {
  await installFakeBridge(page, {
    issues: makeIssues(1000, (index) =>
      makeIssue({
        id: `bza-${index}`,
        title: `Issue ${index}`,
        status: index % 7 === 0 ? 'closed' : index % 5 === 0 ? 'in_progress' : 'open',
        priority: index % 5,
        issue_type: index % 3 === 0 ? 'bug' : 'task',
        assignee: index % 4 === 0 ? 'ada' : index % 4 === 1 ? 'lin' : undefined,
        labels: index % 2 === 0 ? ['ui'] : ['backend', 'perf', 'docs'],
      })
    ),
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
  await expect(page.getByRole('heading', { name: 'Issue 19' })).toBeVisible();

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
      makeIssue(1, { title: 'Fix scroll' }),
      makeIssue(2, { title: 'Fix board' }),
    ],
  });
  await page.goto('/#/w/p1/list');

  const search = page.getByRole('searchbox', { name: 'Search tickets' });
  await search.click();

  // Commit the first word plus its trailing space in one input event and wait
  // for the URL round trip: trimming the query there would eat the space
  // before the next word arrives.
  await search.fill('fix ');
  await expect(page).toHaveURL(/\?q=fix\+$/);

  // Then keep typing at human speed. Machine-gun typing (delay 0-20ms) can put
  // two keystrokes inside one React commit, which drops a character at the
  // input driver level; that is a timing artifact of the test, not app state,
  // so the case must not depend on it.
  await search.pressSequentially('scroll', { delay: 50 });

  await expect(search).toHaveValue('fix scroll');
  await expect(page).toHaveURL(/\?q=fix\+scroll$/);
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

  const sortGroup = page.getByRole('group', { name: 'Sort by' });
  await sortGroup.getByLabel('Sort by: Updated').click();
  await sortGroup.getByRole('radio', { name: 'Priority' }).check();

  const groupGroup = page.getByRole('group', { name: 'Group by' });
  await groupGroup.getByLabel('Group by: No grouping').click();
  await groupGroup.getByRole('radio', { name: 'Status' }).check();
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
