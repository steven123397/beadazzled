import { expect, test, type Page } from '@playwright/test';

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

const FIXTURE = [
  issue('bza-1'),
  issue('bza-2', { status: 'in_progress' }),
  issue('bza-3', { status: 'blocked' }),
];

/** Enough cards that the dragged one is not the first virtual row. */
const MANY = Array.from({ length: 13 }, (_, index) => issue(`bza-${index}`));

function thousandIssues() {
  return Array.from({ length: 1000 }, (_, index) =>
    issue(`bza-${index}`, {
      title: `Issue ${index}`,
      status: index % 7 === 0 ? 'closed' : index % 5 === 0 ? 'in_progress' : 'open',
      priority: index % 5,
    })
  );
}

async function openBoard(page: Page, issues: readonly Record<string, unknown>[]): Promise<void> {
  await installFakeBridge(page, { issues });
  await page.goto('/#/w/p1/board');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
}

async function dragTo(page: Page, id: string, columnId: string): Promise<void> {
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

test('drag to a real column reaches the write gate', async ({ page }) => {
  await openBoard(page, FIXTURE);
  await dragTo(page, 'bza-1', 'in-progress');
  await expect(page.getByRole('alert')).toContainText('bd is not available');
  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveAttribute(
    'data-card-column',
    'ready'
  );
});

test('drag onto Blocked is refused before any write', async ({ page }) => {
  await openBoard(page, FIXTURE);
  await dragTo(page, 'bza-1', 'blocked');
  await expect(page.getByRole('alert')).toContainText('does not accept drops');
});

test('drag out of Blocked is refused', async ({ page }) => {
  await openBoard(page, FIXTURE);
  await dragTo(page, 'bza-3', 'ready');
  await expect(page.getByRole('alert')).toContainText('Blocked cards cannot move out');
});

test('H/L/J/K move focus and Enter opens the card, without bd', async ({ page }) => {
  await openBoard(page, FIXTURE);
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

test('Enter on a filter control activates it instead of opening a ticket', async ({ page }) => {
  await openBoard(page, FIXTURE);
  const details = page.locator('details[aria-label="Priority"]');
  await details.locator('summary').focus();

  await page.keyboard.press('Enter');

  // The native toggle wins; before the fix the global Enter handler opened the
  // focused card and navigated away.
  await expect(page).toHaveURL(/#\/w\/p1\/board$/);
  expect(await details.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true);
});

test('returning from detail restores the column scroll offset', async ({ page }) => {
  await openBoard(page, MANY);
  const ready = page.locator('[data-column-id="ready"] [role="list"]');
  await ready.evaluate((element) => {
    element.scrollTop = 400;
  });
  await expect.poll(() => ready.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.locator('[data-issue-id="bza-3"]').click();
  await expect(page).toHaveURL(/#\/w\/p1\/issue\/bza-3$/);

  await page.goBack();
  await expect(page).toHaveURL(/#\/w\/p1\/board$/);
  await expect.poll(() => ready.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('[data-issue-id="bza-3"]')).toHaveAttribute('data-focused', 'true');
});

test('dragging and refusing a move never calls bd', async ({ page }) => {
  await openBoard(page, FIXTURE);
  await clearInvokeLog(page);

  await dragTo(page, 'bza-1', 'blocked');
  await expect(page.getByRole('alert')).toContainText('does not accept drops');
  await dragTo(page, 'bza-1', 'in-progress');
  await expect(page.getByRole('alert')).toContainText('bd is not available');

  expect(await invokeLog(page)).toEqual([]);
});

test('the drag handle activates the keyboard sensor', async ({ page }) => {
  await openBoard(page, FIXTURE);
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

test('the drag overlay starts at the grabbed card and follows the pointer', async ({ page }) => {
  await openBoard(page, MANY);
  const card = page.locator('[data-issue-id="bza-2"]');
  const source = await card.boundingBox();
  if (source === null) {
    throw new Error('missing card geometry');
  }

  const startX = source.x + 40;
  const startY = source.y + 20;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 180, { steps: 10 });
  await page.waitForTimeout(100);

  const overlay = await page.getByTestId('board-drag-overlay').boundingBox();
  expect(overlay).not.toBeNull();
  // The virtualized card is positioned with `top`, not a translate, so dnd-kit
  // measures its real rect. A regression here puts the overlay at the column
  // top instead of under the grabbed card.
  expect(Math.abs((overlay?.x ?? 0) - (source.x + 120))).toBeLessThan(15);
  expect(Math.abs((overlay?.y ?? 0) - (source.y + 180))).toBeLessThan(20);

  await page.mouse.up();
});

test('a 1000-card board virtualizes and calls no bd while scrolling or filtering', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openBoard(page, thousandIssues());
  const cards = page.locator('[data-issue-id]');
  expect(await cards.count()).toBeLessThan(100);
  await clearInvokeLog(page);

  const ready = page.locator('[data-column-id="ready"] [role="list"]');
  await ready.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator('[data-issue-id="bza-999"]')).toBeVisible();
  expect(await cards.count()).toBeLessThan(100);

  for (const key of ['j', 'j', 'k', 'l', 'h']) {
    await page.keyboard.press(key);
  }

  const search = page.getByRole('searchbox', { name: 'Search tickets' });
  await search.fill('Issue 999');
  await expect(page.getByText('1 / 1000')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-999"]')).toBeVisible();

  // Scrolling, focusing and filtering are all derived in memory.
  expect(await invokeLog(page)).toEqual([]);
});

test('the keyboard sensor completes a drop and reaches the write gate', async ({ page }) => {
  await openBoard(page, FIXTURE);
  await page.getByRole('button', { name: 'Drag bza-1' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveAttribute('data-dragging', 'true');
  // dnd-kit attaches its document key listener on a later tick.
  await page.waitForTimeout(100);

  // The default coordinate getter moves 25px per press; cross into the next
  // column before dropping.
  for (let press = 0; press < 14; press += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Space');

  await expect(page.getByRole('alert')).toContainText('bd is not available');
  await expect(page.locator('[data-issue-id="bza-1"]')).not.toHaveAttribute(
    'data-dragging',
    'true'
  );
});

test('moving a deferred blocked card to Ready names the blockers', async ({ page }) => {
  const fixture = [
    issue('bza-1'),
    issue('bza-9', {
      status: 'deferred',
      dependency_count: 1,
      dependencies: [{ issue_id: 'bza-9', depends_on_id: 'bza-1', type: 'blocks', created_at: TS }],
    }),
  ];
  await openBoard(page, fixture);
  await dragTo(page, 'bza-9', 'ready');

  await expect(page.getByRole('alert')).toContainText('bza-1');
  await expect(page.locator('[data-issue-id="bza-9"]')).toHaveAttribute(
    'data-card-column',
    'backlog'
  );
});

test('scrolling the source column during a drag keeps the overlay alive', async ({ page }) => {
  await openBoard(page, MANY);
  const card = page.locator('[data-issue-id="bza-2"]');
  const box = await card.boundingBox();
  if (box === null) {
    throw new Error('missing card geometry');
  }

  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 30, { steps: 5 });
  await expect(page.getByTestId('board-drag-overlay')).toBeVisible();

  // Scroll the virtualized column while the drag is active: the source card
  // leaves the window, but the overlay must keep following the pointer.
  await page.mouse.move(box.x + 40, box.y + 120);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);

  await expect(page.getByTestId('board-drag-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-drag-overlay')).toBeHidden();
});
