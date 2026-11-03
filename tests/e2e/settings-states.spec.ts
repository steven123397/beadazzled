import { expect, test } from '@playwright/test';

import { clearInvokeLog, installFakeBridge, invokeLog } from './fakeBridge';

test('without bd the page still opens, shows winget and can copy it', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await installFakeBridge(page, {
    bdStatus: { kind: 'not-found', searched: ['C:/tools/bd.exe'] },
  });
  await page.goto('/#/settings');

  // Acceptance 3: the page is usable with no bd at all.
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('bd was not found. Install it, then detect again:')).toBeVisible();
  await expect(page.getByText('winget install --id GasTownHall.Beads -e')).toBeVisible();
  await expect(page.getByText('Looked in: C:/tools/bd.exe')).toBeVisible();

  await page.getByRole('button', { name: 'Copy command' }).click();
  await expect(page.getByText('Copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'winget install --id GasTownHall.Beads -e'
  );
});

test('detect again is the thing that probes, and only when asked', async ({ page }) => {
  await installFakeBridge(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('main').getByText('bd 1.3.2')).toBeVisible();
  await clearInvokeLog(page);

  await page.getByRole('button', { name: 'Detect again' }).click();

  await expect
    .poll(async () => {
      const calls = await invokeLog(page);
      return calls.filter((command) => command === 'bd_status:refresh').length;
    })
    .toBe(1);
});

test('a disabled journal explains how to enable it and copies the command', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await installFakeBridge(page, { syncState: { kind: 'journal-disabled' } });
  await page.goto('/#/settings');

  await expect(page.getByText('Real-time updates are off for this workspace.')).toBeVisible();
  await expect(page.getByText('Enable the journal, then refresh once:')).toBeVisible();

  await page.getByRole('button', { name: 'Copy command' }).click();

  await expect(page.getByText('Copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'bd config set events-journal true'
  );
});

test('switching to another registered workspace goes through the command', async ({ page }) => {
  // `active: false` keeps the default workspace out; both entries are explicit.
  await installFakeBridge(page, {
    workspaces: [
      { path: '/repo/alpha', name: 'alpha', projectId: 'p1' },
      { path: '/repo/beta', name: 'beta', projectId: 'p2' },
    ],
    active: false,
  });
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await clearInvokeLog(page);

  const betaRow = page.getByRole('listitem').filter({ hasText: '/repo/beta' });
  await betaRow.getByRole('button', { name: 'Open' }).click();

  await expect(page).toHaveURL(/#\/w\/p2\/list$/);
  const calls = await invokeLog(page);
  expect(calls).toContain('workspace_switch');
});
