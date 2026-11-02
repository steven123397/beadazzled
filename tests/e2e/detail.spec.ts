import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog } from './fakeBridge';

const TS = '2026-11-01T00:00:00Z';

function issue(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Issue ${id}`,
    description: '',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: TS,
    updated_at: TS,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

test('detail renders markdown, metadata, dependencies and comments from memory', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [
      issue('bza-a', { title: 'Blocker' }),
      issue('bza-b', {
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
        dependencies: [{ issue_id: 'bza-b', depends_on_id: 'bza-a', type: 'blocks', created_at: TS }],
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

test('opening a ticket from the list is in-memory and inside the 50ms budget', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installFakeBridge(page, {
    issues: Array.from({ length: 1000 }, (_, index) => issue(`bza-${index}`)),
  });
  await page.goto('/#/w/p1/list');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();

  // Warm the detail chunk once so the measurement covers rendering, not the
  // first lazy import.
  await page.locator('[data-issue-id="bza-0"]').click();
  await expect(page.getByRole('heading', { name: 'Issue bza-0' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();

  await clearInvokeLog(page);

  const samples: number[] = [];
  for (const id of ['bza-1', 'bza-2', 'bza-3', 'bza-4', 'bza-5']) {
    samples.push(
      await page.evaluate(async (issueId) => {
        const row = document.querySelector(`[data-issue-id="${issueId}"]`);
        if (row === null) {
          throw new Error(`row ${issueId} is not rendered`);
        }
        const started = performance.now();
        row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise<void>((resolve) => {
          const check = () => {
            if (document.querySelector('article h1') !== null) {
              // One frame: the same "input to rendered results" boundary the
              // palette measurement uses.
              requestAnimationFrame(() => resolve());
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        });
        return performance.now() - started;
      }, id)
    );

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();
  }

  samples.sort((left, right) => left - right);
  expect(samples[2]).toBeLessThan(50);
  expect(await invokeLog(page)).toEqual([]);
});