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

async function dragTo(
  page: import('@playwright/test').Page,
  id: string,
  columnId: string
): Promise<void> {
  const source = page.locator(`[data-issue-id="${id}"]`);
  const start = await source.boundingBox();
  const target = await page.locator(`[data-column-id="${columnId}"]`).boundingBox();
  if (start === null || target === null) {
    throw new Error('missing drag geometry');
  }
  await page.mouse.move(start.x + start.width / 2, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + 20, { steps: 5 });
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await installFakeBridge(page, {
    issues: [
      issue('bza-1'),
      issue('bza-2', { status: 'in_progress' }),
      issue('bza-3', { status: 'blocked' }),
    ],
  });
  await page.goto('/#/w/p1/board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
});

test('drag to a real column reaches the write gate', async ({ page }) => {
  await dragTo(page, 'bza-1', 'in-progress');
  await expect(page.getByRole('alert')).toContainText('bd is not available');
  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveAttribute(
    'data-card-column',
    'ready'
  );
});

test('drag onto Blocked is refused before any write', async ({ page }) => {
  await dragTo(page, 'bza-1', 'blocked');
  await expect(page.getByRole('alert')).toContainText('does not accept drops');
});

test('drag out of Blocked is refused', async ({ page }) => {
  await dragTo(page, 'bza-3', 'ready');
  await expect(page.getByRole('alert')).toContainText('Blocked cards cannot move out');
});

test('H/L/J/K move focus and Enter opens the card, without bd', async ({ page }) => {
  await clearInvokeLog(page);
  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveAttribute('data-focused', 'true');

  await page.keyboard.press('l');
  await expect(page.locator('[data-issue-id="bza-2"]')).toHaveAttribute('data-focused', 'true');

  await page.keyboard.press('h');
  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveAttribute('data-focused', 'true');

  await page.keyboard.press('j');
  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveAttribute('data-focused', 'true');

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/w\/p1\/issue\/bza-1$/);

  expect(await invokeLog(page)).toEqual([]);
});

test('dragging and refusing a move never calls bd', async ({ page }) => {
  await clearInvokeLog(page);

  await dragTo(page, 'bza-1', 'blocked');
  await expect(page.getByRole('alert')).toContainText('does not accept drops');
  await dragTo(page, 'bza-1', 'in-progress');
  await expect(page.getByRole('alert')).toContainText('bd is not available');

  expect(await invokeLog(page)).toEqual([]);
});

test('the drag handle activates the keyboard sensor', async ({ page }) => {
  await page.getByRole('button', { name: 'Drag bza-1' }).focus();
  await page.keyboard.press('Space');

  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveAttribute('data-dragging', 'true');
  // dnd-kit attaches its document key listener with setTimeout(0) after the
  // activation; give that tick a moment before sending the cancel key.
  await page.waitForTimeout(100);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-issue-id="bza-1"]')).not.toHaveAttribute(
    'data-dragging',
    'true'
  );
});
