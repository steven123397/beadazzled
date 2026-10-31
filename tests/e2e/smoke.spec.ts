import { expect, test } from '@playwright/test';

test('renders the scaffold shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'beadazzled' })).toBeVisible();
});
