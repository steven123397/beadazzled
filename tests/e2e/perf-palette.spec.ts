import { expect, test } from '@playwright/test';

import { installFakeBridge } from './fakeBridge';

function issue(index: number) {
  return {
    id: `bza-${index}`,
    title: `Keyboard issue ${index}`,
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
  };
}

async function measure(page: import('@playwright/test').Page, query: string): Promise<number> {
  return page.evaluate(async (value) => {
    const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
    if (input === null) throw new Error('palette input missing');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter === undefined) throw new Error('value setter missing');
    const started = performance.now();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - started;
  }, query);
}

test('palette input to rendered results stays under 50ms', async ({ page }) => {
  test.setTimeout(60_000);
  await installFakeBridge(page, {
    issues: Array.from({ length: 1200 }, (_, index) => issue(index)),
  });
  await page.goto('/#/w/p1/list');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox')).toBeVisible({ timeout: 15_000 });

  await measure(page, 'key');
  const samples: number[] = [];
  for (const query of ['keyboard', 'keyboar', 'keyboa', 'keybo', 'keyb']) {
    samples.push(await measure(page, query));
  }
  await expect(page.getByRole('option')).toHaveCount(50);
  samples.sort((left, right) => left - right);
  expect(samples[2]).toBeLessThan(50);
});