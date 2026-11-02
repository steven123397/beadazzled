import { expect, test } from '@playwright/test';

import { installFakeBridge } from './fakeBridge';

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

test('scrolling a 1000-issue list keeps frame time near the 60fps budget', async ({ page }) => {
  test.setTimeout(60_000);
  await openThousandIssueList(page);

  const result = await page.evaluate(async () => {
    const list = document.querySelector<HTMLElement>('[role="list"]');
    if (list === null) {
      throw new Error('list missing');
    }

    const frames: number[] = [];
    let previous = performance.now();
    for (let step = 0; step < 120; step += 1) {
      list.scrollTop += 48;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
    }
    frames.sort((left, right) => left - right);

    return {
      p50: frames[Math.floor(frames.length * 0.5)] ?? 0,
      p95: frames[Math.floor(frames.length * 0.95)] ?? 0,
      max: frames[frames.length - 1] ?? 0,
    };
  });

  // One rAF tick is 16.7ms on a 60Hz display. The median stays at a full frame;
  // the p95 allowance covers Chromium timer noise and the occasional mount of
  // newly visible rows, while a real stall (several dropped frames) still fails.
  expect(result.p95).toBeLessThan(24);
  expect(result.max).toBeLessThan(50);
});
