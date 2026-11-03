import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog } from './fakeBridge';

test('opening settings makes no bd call and preferences persist', async ({ page }) => {
  await installFakeBridge(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('main').getByText('bd 1.3.2')).toBeVisible();

  // Everything the page itself needs is already loaded; interacting with the
  // general block must not reach bd either (SPEC-settings acceptance 8).
  await clearInvokeLog(page);

  await page.getByLabel('Language').selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(await page.evaluate(() => localStorage.getItem('beadazzled.language'))).toBe('zh-CN');

  await page.getByLabel('主题').selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('beadazzled.theme'))).toBe('dark');

  const calls = await invokeLog(page);
  expect(calls.filter((command) => command === 'bd_status')).toEqual([]);
  expect(calls).toContain('app_set_preferences');
});

test('cancelling the bd picker leaves the configuration alone', async ({ page }) => {
  await installFakeBridge(page, { dialogPath: null });
  await page.goto('/#/settings');
  await expect(page.getByRole('main').getByText('bd 1.3.2')).toBeVisible();
  await clearInvokeLog(page);

  await page.getByRole('button', { name: 'Choose bd…' }).click();

  // Cancelling is not a failure: no error, no write, no probe.
  await expect(page.getByRole('main').getByText('bd 1.3.2')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const calls = await invokeLog(page);
  expect(calls.filter((command) => command.startsWith('bd_status'))).toEqual([]);
});

test('diagnostics load on demand and copy the fixed report', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await installFakeBridge(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await clearInvokeLog(page);

  await page.getByRole('button', { name: 'Load diagnostics' }).click();

  await expect(page.getByRole('table', { name: 'Recent bd calls' })).toBeVisible();
  await expect(page.getByText('embedded')).toBeVisible();
  const calls = await invokeLog(page);
  expect(calls).toContain('settings_diagnostics');
  expect(calls.filter((command) => command.startsWith('bd_status'))).toEqual([]);

  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.getByText('Copied')).toBeVisible();

  const report = await page.evaluate(() => navigator.clipboard.readText());
  // Windows normalises clipboard text to CRLF.
  const lines = report.split(/\r?\n/);
  expect(lines).toHaveLength(6);
  expect(lines[0]).toBe('beadazzled 0.1.0');
  expect(lines[1]).toBe('bd 1.3.2 at bd');
  expect(lines[3]).toContain('dolt_mode=embedded');
});
