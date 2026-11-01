import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog } from './fakeBridge';

test('the keyboard loop opens workspace, list, detail, back and board without bd', async ({
  page,
}) => {
  await installFakeBridge(page);
  await page.goto('/');

  // Root redirect from the registered workspace lands on List.
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();
  await clearInvokeLog(page);

  // List -> Detail through the palette.
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('bza-1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Issue bza-1' })).toBeVisible();
  await expect(page).toHaveURL(/#\/w\/p1\/issue\/bza-1$/);

  // Detail -> List with Escape.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'List' })).toBeVisible();

  // List -> Board with the g chord.
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();
  await expect(page).toHaveURL(/#\/w\/p1\/board$/);

  // Navigation is in-memory only; no bridge command ran after the initial load.
  expect(await invokeLog(page)).toEqual([]);
});
