#!/usr/bin/env node
/**
 * Captures the visual baseline for the design foundation.
 *
 * Screenshots go to `docs/design/<date>-foundation/` so a later polish pass can
 * compare against what shipped. They are produced from the production bundle
 * (the same `dist-e2e` seam `measure:navigation` uses) rather than the dev
 * server, so what is on screen matches what a user gets.
 *
 * Usage: node scripts/capture-ui.mjs [--out=docs/design/2026-11-02-foundation]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-e2e');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const TS = '2026-11-01T00:00:00Z';
const PORT = 1433;

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const shots = path.resolve(
  root,
  outArg?.slice('--out='.length) ?? 'docs/design/2026-11-02-foundation'
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function issue(id, overrides = {}) {
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
    issue('bza-4', { title: 'Write the release notes', status: 'closed', priority: 4 }),
    issue('bza-5', { title: 'Very urgent fix', status: 'open', priority: 0 }),
  ];
}

function build() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_'))
  );
  env.VITE_E2E = '1';
  const result = spawnSync(process.execPath, [viteBin, 'build', '--outDir', 'dist-e2e'], {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`production build failed (exit ${result.status ?? 'signal'})`);
  }
}

async function serve() {
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--outDir', 'dist-e2e', '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: 'ignore' }
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${PORT}/`);
      if (response.ok) {
        return child;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(150);
  }
  child.kill();
  throw new Error(`preview server did not listen on ${PORT}`);
}

async function capture(browser, theme, name, route) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, theme });
  try {
    await page.addInitScript(
      ({ records, mode }) => {
        const workspace = {
          path: '/repo/p1',
          name: 'alpha',
          projectId: 'p1',
          isWorktree: false,
          lastOpenedAt: '2026-11-01T00:00:00Z',
          checkpoint: null,
        };
        window.__TAURI_INTERNALS__ = {
          invoke: async (command) => {
            if (command === 'workspace_snapshot') {
              return {
                config: {
                  schemaVersion: 1,
                  bdPath: null,
                  language: 'en',
                  theme: mode,
                  lastWorkspacePath: null,
                  workspaces: [workspace],
                },
                missing: [],
                active: workspace.path,
                corruptBackup: null,
              };
            }
            if (command === 'bd_status') {
              return { kind: 'ready', path: 'bd', version: '1.3.2' };
            }
            throw new Error(`unexpected command: ${command}`);
          },
        };
        window.__BEADAZZLED_E2E__ = {
          issues: records,
          syncState: { kind: 'healthy', lastSeq: 1, lastEventAt: null },
          theme: mode,
        };
      },
      { records: fixture(), mode: theme }
    );

    await page.goto(`http://localhost:${PORT}/#${route}`);
    await page.waitForSelector('[data-testid="list-view"][data-state="ready"], article', {
      state: 'visible',
      timeout: 15_000,
    });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    await page.screenshot({ path: path.join(shots, `${name}-${theme}.png`) });
  } finally {
    await page.close();
  }
}

async function main() {
  if (!existsSync(viteBin)) {
    throw new Error(`vite not found at ${viteBin}; run npm install first`);
  }
  await mkdir(shots, { recursive: true });
  await rm(outDir, { recursive: true, force: true });
  build();

  let server;
  let browser;
  try {
    server = await serve();
    browser = await chromium.launch();
    for (const theme of ['light', 'dark']) {
      await capture(browser, theme, 'list', '/w/p1/list');
      await capture(browser, theme, 'detail', '/w/p1/issue/bza-1');
    }
    console.log(`screenshots written to ${path.relative(root, shots)}`);
  } finally {
    await browser?.close();
    server?.kill();
    await rm(outDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`capture-ui failed: ${error.message}`);
  process.exitCode = 1;
});
