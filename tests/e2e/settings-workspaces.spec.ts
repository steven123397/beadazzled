import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog } from './fakeBridge';

test('adding, opening and removing workspaces keeps the registry in sync', async ({ page }) => {
  await installFakeBridge(page, { dialogPath: '/repo/beta' });
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const alphaRow = page.getByRole('listitem').filter({ hasText: '/repo/p1' });
  await expect(alphaRow).toBeVisible();
  await clearInvokeLog(page);

  await page.getByRole('button', { name: 'Add workspace…' }).click();

  const betaRow = page.getByRole('listitem').filter({ hasText: '/repo/beta' });
  await expect(betaRow).toBeVisible();

  await betaRow.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/#\/w\/project-2\/list$/);
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();

  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page
    .getByRole('listitem')
    .filter({ hasText: '/repo/p1' })
    .getByRole('button', { name: 'Remove' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Remove workspace?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove' }).click();

  await expect(page.getByRole('listitem').filter({ hasText: '/repo/p1' })).toHaveCount(0);

  const calls = await invokeLog(page);
  // Registry operations reload the cached bd status, but nothing in this flow
  // probes bd (only an explicit refresh does that in the real backend).
  expect(calls.filter((command) => command === 'bd_status:refresh')).toEqual([]);
  expect(calls).toContain('workspace_add');
  // Adding makes the new workspace active, so opening it only navigates.
  expect(calls).toContain('workspace_remove');
});

test('relocating a workspace moves its path and keeps its name', async ({ page }) => {
  await installFakeBridge(page, { dialogPath: '/repo/moved' });
  await page.goto('/#/settings');
  const alphaRow = page.getByRole('listitem').filter({ hasText: '/repo/p1' });
  await expect(alphaRow).toBeVisible();

  await alphaRow.getByRole('button', { name: 'Relocate…' }).click();

  const moved = page.getByRole('listitem').filter({ hasText: '/repo/moved' });
  await expect(moved).toBeVisible();
  await expect(moved).toContainText('alpha');
  await expect(page.getByRole('listitem').filter({ hasText: '/repo/p1' })).toHaveCount(0);
});
