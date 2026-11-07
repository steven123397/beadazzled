#!/usr/bin/env node
/**
 * Captures the visual baseline for the list, its interaction states and the
 * screens that share the shell card.
 *
 * Screenshots go to `docs/design/<date>-<screen>/` so a later polish pass can
 * compare against what shipped. They are produced from the production bundle
 * (the same `dist-e2e` seam `measure:navigation` uses) rather than the dev
 * server, so what is on screen matches what a user gets.
 *
 * Usage: node scripts/capture-ui.mjs [--out=docs/design/2026-11-03-list]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMain } from './lib/cli.mjs';
import { resolvePort, withPreview } from './lib/prod-preview.mjs';
import { installSeam, makeIssue } from './lib/seam.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = '2026-11-01T00:00:00Z';
const PORT = resolvePort(process.env.CAPTURE_PORT, { envName: 'CAPTURE_PORT', defaultPort: 1433 });

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const shots = path.resolve(
  root,
  outArg?.slice('--out='.length) ?? 'docs/design/2026-11-02-foundation'
);

function issue(id, overrides = {}) {
  return makeIssue(id, overrides);
}

function fixture() {
  return [
    issue('bza-1', {
      title: 'Detail reading: markdown, metadata and dependencies',
      description: 'Beads stores issues in a Dolt database.\n\n- [x] spec\n- [ ] board',
      status: 'in_progress',
      priority: 1,
      labels: ['detail', 'phase-5'],
      assignee: 'ada',
      dependencies: [{ issue_id: 'bza-1', depends_on_id: 'bza-2', type: 'blocks', created_at: TS }],
      comments: [
        { id: 'c1', issue_id: 'bza-1', author: 'lin', text: 'Looks good', created_at: TS },
      ],
      comment_count: 1,
    }),
    issue('bza-2', { title: 'Guard blocked status changes', status: 'blocked', priority: 2 }),
    issue('bza-3', { title: 'Ship the board', status: 'deferred', priority: 3, labels: ['board'] }),
    issue('bza-4', {
      title: 'Write the release notes',
      status: 'closed',
      priority: 4,
      labels: ['polish', 'v0.1.0'],
    }),
    issue('bza-5', {
      title: 'Very urgent fix',
      status: 'open',
      priority: 0,
      labels: ['interaction', 'polish', 'phase-8'],
    }),
  ];
}

const FIXTURE = fixture();

async function capture(
  browser,
  {
    theme,
    name,
    route,
    width = 1280,
    height = 800,
    hover,
    focus = false,
    collapseSidebar = false,
    openFilter,
    waitFor = '[data-testid="list-view"][data-state="ready"], article',
  },
  port = PORT
) {
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme: theme,
  });
  try {
    await installSeam(page, {
      projectId: 'p1',
      workspaceName: 'alpha',
      issues: FIXTURE,
      theme,
      recordInvokeLog: false,
    });

    await page.goto(`http://localhost:${port}/#${route}`);
    await page.waitForSelector(waitFor, {
      state: 'visible',
      timeout: 15_000,
    });
    if (collapseSidebar) {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await page.waitForTimeout(250);
    }
    if (openFilter !== undefined) {
      await page.getByRole('group', { name: openFilter }).locator('summary').click();
      await page.waitForTimeout(100);
    }
    if (focus) {
      await page.keyboard.press('j');
    }
    if (hover !== undefined) {
      await page.hover(`[data-issue-id="${hover}"]`);
    }
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    await page.screenshot({ path: path.join(shots, `${name}-${theme}.png`) });
  } finally {
    await page.close();
  }
}

async function main() {
  await mkdir(shots, { recursive: true });

  await withPreview({ port: PORT, envName: 'CAPTURE_PORT' }, async ({ browser }) => {
    const shotsToTake = [
      { theme: 'light', name: 'list', route: '/w/p1/list' },
      { theme: 'dark', name: 'list', route: '/w/p1/list' },
      { theme: 'light', name: 'list-grouped', route: '/w/p1/list?group=status' },
      { theme: 'dark', name: 'list-grouped', route: '/w/p1/list?group=status' },
      { theme: 'light', name: 'list-hover', route: '/w/p1/list', hover: 'bza-2' },
      { theme: 'light', name: 'list-focus', route: '/w/p1/list', focus: true },
      { theme: 'light', name: 'list-narrow', route: '/w/p1/list', width: 1024, height: 768 },
      {
        theme: 'light',
        name: 'list-collapsed',
        route: '/w/p1/list',
        collapseSidebar: true,
      },
      {
        theme: 'light',
        name: 'list-assignee-open',
        route: '/w/p1/list',
        openFilter: 'Assignee',
      },
      {
        theme: 'light',
        name: 'list-sort-open',
        route: '/w/p1/list',
        openFilter: 'Sort by',
      },
      {
        theme: 'light',
        name: 'list-workspace-open',
        route: '/w/p1/list',
        openFilter: 'Workspace',
      },
      { theme: 'light', name: 'detail', route: '/w/p1/issue/bza-1' },
      { theme: 'dark', name: 'detail', route: '/w/p1/issue/bza-1' },
      {
        theme: 'light',
        name: 'board',
        route: '/w/p1/board',
        waitFor: '[data-testid="board-view"][data-state="ready"]',
      },
      {
        theme: 'dark',
        name: 'board',
        route: '/w/p1/board',
        waitFor: '[data-testid="board-view"][data-state="ready"]',
      },
      { theme: 'light', name: 'settings', route: '/settings', waitFor: '#settings-title' },
    ];
    for (const shot of shotsToTake) {
      await capture(browser, shot, PORT);
    }
    console.log(`screenshots written to ${path.relative(root, shots)}`);
  });
}

runMain('capture-ui failed', main);
