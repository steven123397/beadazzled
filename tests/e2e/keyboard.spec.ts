import { expect, test } from '@playwright/test';

test('keyboard shortcuts open the palette and the help panel', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Command palette');
  await expect(help).toContainText('Ctrl+K');

  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();

  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
  ).toBe(true);

  await page.getByRole('combobox').fill('settings');
  await expect(palette.getByText('Go to Settings')).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/#\/settings$/);
});

test('single-key shortcuts do not fire while typing in the palette', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.keyboard.press('Control+k');

  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();

  await page.getByRole('combobox').fill('?');

  // A bare "?" must stay in the input instead of opening the help panel.
  await expect(palette).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
  await expect(page.getByRole('combobox')).toHaveValue('?');
});
