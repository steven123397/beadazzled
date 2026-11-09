import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog, makeIssue, makeIssues } from './fakeBridge';

const TS = '2026-11-01T00:00:00Z';

test('detail renders markdown, metadata, dependencies and comments from memory', async ({
  page,
}) => {
  await installFakeBridge(page, {
    issues: [
      makeIssue('bza-a', { title: 'Blocker' }),
      makeIssue('bza-b', {
        title: 'Document reading',
        description: [
          '| Name | State |',
          '| --- | --- |',
          '| beta | open |',
          '',
          '![diagram](https://example.com/pic.png)',
        ].join('\n'),
        acceptance_criteria: '- [x] shipped',
        assignee: 'ada',
        labels: ['ui'],
        dependencies: [
          { issue_id: 'bza-b', depends_on_id: 'bza-a', type: 'blocks', created_at: TS },
        ],
        comments: [
          { id: 'c1', issue_id: 'bza-b', author: 'lin', text: 'Looks good', created_at: TS },
        ],
        comment_count: 1,
      }),
    ],
  });
  await page.goto('/#/w/p1/issue/bza-b');

  await expect(page.getByRole('heading', { name: 'Document reading' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(page.getByText('ada', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Blocked by' })).toContainText('bza-a');
  await expect(page.getByText('Looks good')).toBeVisible();

  // A remote image is shown as a deliberate link; no request is made for it.
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'https://example.com/pic.png' })).toBeVisible();
});

test('opening a ticket from the list renders from memory without calling bd', async ({ page }) => {
  // This is a smoke test: the dev server's timings say nothing about the
  // production bundle, so the 50ms budget is judged by
  // `npm run measure:navigation` against `dist-e2e`. Here we only pin that a
  // deep list open renders the detail and never reaches bd.
  test.setTimeout(90_000);
  await installFakeBridge(page, {
    issues: makeIssues(1000, (index) => makeIssue(`bza-${index}`)),
  });
  await page.goto('/#/w/p1/list');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();

  await page.locator('[data-issue-id="bza-0"]').click();
  await expect(page.getByRole('heading', { name: 'Issue bza-0' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();

  await clearInvokeLog(page);

  for (const id of ['bza-1', 'bza-2', 'bza-3', 'bza-4', 'bza-5']) {
    await page.locator(`[data-issue-id="${id}"]`).click();
    await expect(page.getByRole('heading', { name: `Issue ${id}` })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();
  }

  expect(await invokeLog(page)).toEqual([]);
});
test('injected markdown never creates executable nodes', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [
      makeIssue('bza-x', {
        title: 'Injection sample',
        description: [
          '<script>window.__pwned = true;</script>',
          '<iframe src="https://evil.example"></iframe>',
          '<img src="x" onerror="window.__pwned = true">',
          '[click](javascript:window.__pwned=true)',
        ].join('\n\n'),
      }),
    ],
  });
  await page.goto('/#/w/p1/issue/bza-x');
  await expect(page.getByRole('heading', { name: 'Injection sample' })).toBeVisible();

  const article = page.locator('article');
  await expect(article.locator('script')).toHaveCount(0);
  await expect(article.locator('iframe')).toHaveCount(0);
  await expect(article.locator('img')).toHaveCount(0);
  await expect(article.locator('[onerror]')).toHaveCount(0);
  await expect(article.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)
  ).toBeUndefined();
});

test('blocked-by and blocks both resolve, including a deleted target', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [
      makeIssue('bza-a'),
      makeIssue('bza-b', {
        dependencies: [
          { issue_id: 'bza-b', depends_on_id: 'bza-a', type: 'blocks', created_at: TS },
          { issue_id: 'bza-b', depends_on_id: 'bza-gone', type: 'blocks', created_at: TS },
        ],
      }),
      makeIssue('bza-c', {
        dependencies: [
          { issue_id: 'bza-c', depends_on_id: 'bza-a', type: 'blocks', created_at: TS },
        ],
      }),
    ],
  });

  await page.goto('/#/w/p1/issue/bza-b');
  const blockedBy = page.getByRole('region', { name: 'Blocked by' });
  await expect(blockedBy).toContainText('bza-a');
  await expect(blockedBy).toContainText('bza-gone');
  await expect(blockedBy).toContainText('Not found');

  await page.goto('/#/w/p1/issue/bza-a');
  const blocks = page.getByRole('region', { name: 'Blocks' });
  await expect(blocks).toContainText('bza-b');
  await expect(blocks).toContainText('bza-c');
});
