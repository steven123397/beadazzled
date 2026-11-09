import { expect, test } from '@playwright/test';

import { installFakeBridge, makeIssue } from './fakeBridge';

function issue(index: number, overrides: Record<string, unknown> = {}) {
  return makeIssue({
    id: `bza-${index}`,
    title: `Issue ${index}`,
    assignee: 'ada',
    labels: ['ui'],
    ...overrides,
  });
}


const loading = { kind: 'loading', step: 'export' };
const healthy = { kind: 'healthy', lastSeq: 1, lastEventAt: null };
const unavailable = {
  kind: 'bd-unavailable',
  error: { code: 'BD_NOT_FOUND', message: 'bd missing' },
};

test('a loading baseline shows skeleton rows, not an empty list', async ({ page }) => {
  await installFakeBridge(page, { issues: [], syncState: loading });
  await page.goto('/#/w/p1/list');

  await expect(page.getByTestId('list-view')).toHaveAttribute('data-state', 'loading');
  await expect(page.getByRole('status', { name: 'Loading tickets' })).toBeVisible();
  await expect(page.getByTestId('list-skeleton-row')).toHaveCount(10);
  await expect(page.getByRole('list')).toHaveCount(0);
});

test('an empty workspace has its own state and copy', async ({ page }) => {
  await installFakeBridge(page, { issues: [], syncState: healthy });
  await page.goto('/#/w/p1/list');

  await expect(page.getByTestId('list-view')).toHaveAttribute('data-state', 'empty');
  await expect(page.getByText('No tickets yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create the first ticket' })).toBeDisabled();
});

test('a filtered list with no matches can be cleared', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [issue(1, { title: 'Fix scroll' }), issue(2, { title: 'Fix board' })],
    syncState: healthy,
  });
  await page.goto('/#/w/p1/list?q=zzz');

  await expect(page.getByTestId('list-view')).toHaveAttribute('data-state', 'no-match');
  await expect(page.getByText('No matching tickets')).toBeVisible();

  await page.getByRole('button', { name: 'Show all tickets' }).click();

  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page).not.toHaveURL(/q=/);
});

test('bd unavailable keeps cached tickets visible and marked stale', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [issue(1, { title: 'Fix scroll' })],
    syncState: unavailable,
  });
  await page.goto('/#/w/p1/list');

  await expect(page.getByTestId('list-view')).toHaveAttribute('data-state', 'bd-unavailable');
  await expect(page.getByRole('alert')).toContainText(
    'bd is unavailable. Showing the last loaded tickets.'
  );
  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
});

test('bd unavailable without cached tickets shows the error state', async ({ page }) => {
  await installFakeBridge(page, { issues: [], syncState: unavailable });
  await page.goto('/#/w/p1/list');

  await expect(page.getByTestId('list-view')).toHaveAttribute('data-state', 'bd-unavailable');
  await expect(page.getByRole('alert')).toContainText('bd is unavailable');
  await expect(page.getByText('bd missing')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('journal degradation leaves the list usable and shows the warning in the status bar', async ({
  page,
}) => {
  await installFakeBridge(page, {
    issues: [issue(1)],
    syncState: { kind: 'journal-disabled' },
  });
  await page.goto('/#/w/p1/list');

  await expect(page.getByTestId('list-view')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('list-view')).toHaveAttribute('data-sync', 'journal-disabled');
  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
  await expect(page.getByLabel('Status bar')).toContainText('Journal off');
});

test('a deep link restores filters and survives a reload', async ({ page }) => {
  const issues = [
    issue(1, {
      title: 'Fix scroll',
      status: 'open',
      priority: 0,
      issue_type: 'bug',
      assignee: 'ada',
      labels: ['ui'],
    }),
    issue(2, {
      title: 'Fix board',
      status: 'closed',
      priority: 1,
      issue_type: 'task',
      assignee: 'lin',
      labels: ['ui'],
    }),
    issue(3, { title: 'Other work', status: 'open', priority: 2 }),
  ];
  await installFakeBridge(page, { issues, syncState: healthy });

  const url =
    '/#/w/p1/list?q=fix&status=open&priority=0&type=bug&assignee=ada&label=ui&group=status&sort=priority%3Aasc&ready=1';
  await page.goto(url);

  await expect(page.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('fix');
  await expect(page.getByText('1 / 3')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-2"]')).toHaveCount(0);
  await expect(page.locator('[data-issue-id="bza-3"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Open/ })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('fix');
  await expect(page.getByText('1 / 3')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
});

test('the filter bar updates the count and clears back to the full list', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [
      issue(1, { title: 'Fix scroll', status: 'open' }),
      issue(2, { title: 'Fix board', status: 'closed' }),
      issue(3, { title: 'Other work', status: 'open' }),
    ],
    syncState: healthy,
  });
  await page.goto('/#/w/p1/list');
  await expect(page.getByText('3 / 3')).toBeVisible();

  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: 'Search tickets' });
  await expect(search).toBeFocused();
  await search.fill('fix');
  await expect(page.getByText('2 / 3')).toBeVisible();

  const status = page.locator('details[aria-label="Status"]');
  await status.locator('summary').click();
  const open = status.getByRole('checkbox', { name: 'Open' });
  await open.click();
  await expect(open).toBeChecked();
  await expect(page.getByText('1 / 3')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-2"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear filters' }).click();

  await expect(page.getByText('3 / 3')).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(page.locator('[data-issue-id="bza-3"]')).toBeVisible();
});

test('clicking List in the sidebar keeps the active filters', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [issue(1, { title: 'Fix scroll' }), issue(2, { title: 'Other work' })],
    syncState: healthy,
  });
  await page.goto('/#/w/p1/list?q=fix');
  await expect(page.getByText('1 / 2')).toBeVisible();

  await page.getByRole('link', { name: 'List' }).click();

  await expect(page).toHaveURL(/q=fix/);
  await expect(page.getByRole('searchbox', { name: 'Search tickets' })).toHaveValue('fix');
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-2"]')).toHaveCount(0);
});

test('group headers collapse their rows without changing the count', async ({ page }) => {
  await installFakeBridge(page, {
    issues: [issue(1, { status: 'open' }), issue(2, { status: 'closed' })],
    syncState: healthy,
  });
  await page.goto('/#/w/p1/list?group=status');

  await expect(page.getByRole('button', { name: /Open/ })).toBeVisible();
  await expect(page.locator('[data-issue-id="bza-1"]')).toBeVisible();
  await expect(page.getByText('2 / 2')).toBeVisible();

  await page.getByRole('button', { name: /Open/ }).click();

  await expect(page.locator('[data-issue-id="bza-1"]')).toHaveCount(0);
  await expect(page.locator('[data-issue-id="bza-2"]')).toBeVisible();
  await expect(page.getByText('2 / 2')).toBeVisible();
});
