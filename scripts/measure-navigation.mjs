#!/usr/bin/env node
/**
 * Measures detail navigation on the production bundle.
 *
 * CONSTRAINTS budgets two numbers: opening a ticket from the list stays under
 * 50ms, and a 64 KiB Markdown body renders in under 100ms. The dev server
 * roughly doubles React's work and the lazy detail chunk would be fetched over
 * Vite's transform pipeline, so this script builds `dist-e2e` (with the
 * test-only data seam), serves it with `vite preview`, and drives Chromium
 * against 1000 tickets.
 *
 * Each sample measures click -> first painted frame. The detail chunk is warmed
 * once per run so the number covers rendering, not the first chunk fetch. The
 * body sample uses a 64 KiB description and waits for a sentinel that only
 * appears after the whole Markdown tree has rendered. Opening a ticket must not
 * call bd; a non-empty invoke log is a hard failure, while an over-budget
 * sample is reported as OVER (measurement-only, like the startup budgets).
 *
 * Usage: npm run measure:navigation -- [--runs=5] [--json]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-e2e');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const budgets = { openP95: 50, markdownP50: 100 };
const TS = '2026-11-01T00:00:00Z';
const SENTINEL = '64KIB-SENTINEL';
let port = 1432;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolvePort(raw) {
  if (raw === undefined || raw === '') {
    return 1432;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error('NAV_PORT must be an integer between 1024 and 65535');
  }
  return value;
}

function parseArgs(argv) {
  const options = { runs: 5, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const inline = separator === -1 ? undefined : arg.slice(separator + 1);
    if (name === '--json') {
      options.json = true;
    } else if (name === '--runs') {
      const value = Number(inline ?? argv[(index += 1)]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--runs needs a positive integer');
      }
      options.runs = value;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

function issue(id, overrides = {}) {
  return {
    id,
    title: `Issue ${id}`,
    description: 'A short **description** for this ticket.',
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

function bigDescription() {
  // A realistic long ticket: mostly prose with a heading every few thousand
  // characters and a handful of lists, one code block and one table. A body
  // where every paragraph is its own list would create thousands of extra
  // nodes and measure a shape no real ticket has.
  const sentence =
    'Beads stores issues in a Dolt database and exposes them through the bd command line. ';
  let text = '';
  let section = 0;
  while (text.length < 64 * 1024) {
    if (section % 12 === 0) {
      text += `## Section ${section}\n\n`;
    }
    text += `${sentence.repeat(12)}\n\n`;
    if (section % 16 === 0) {
      text += 'Some **bold**, `code`, and a [link](https://example.com).\n\n';
    }
    if (section % 32 === 0) {
      text += '- one\n- two\n\n';
    }
    if (section === 48) {
      text += '```ts\nconst answer = 42;\n```\n\n';
    }
    if (section === 60) {
      text += '| Name | State |\n| --- | --- |\n| beta | open |\n\n';
    }
    section += 1;
  }
  return `${text.slice(0, 64 * 1024)}\n\n${SENTINEL}`;
}

function tickets() {
  const list = Array.from({ length: 1000 }, (_, index) => issue(`bza-${index}`));
  // Keep the long ticket near the top; the default sort orders by timestamp,
  // then id, so an id outside the sequence could land off-screen.
  list[1] = issue('bza-1', { description: bigDescription() });
  return list;
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
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
    throw new Error(`port ${port} is already serving; set NAV_PORT to a free port`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already serving')) {
      throw error;
    }
  }

  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: 'ignore' }
  );

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`preview server exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://localhost:${port}/`);
      if (response.ok) {
        return child;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(150);
  }

  child.kill();
  throw new Error(`preview server did not listen on ${port}`);
}

async function waitForList(page) {
  await page.waitForSelector('[data-testid="list-view"][data-state="ready"]', {
    state: 'visible',
    timeout: 15_000,
  });
}

async function backToList(page) {
  await page.keyboard.press('Escape');
  await waitForList(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
}

async function scrollListToTop(page) {
  await page.evaluate(() => {
    const list = document.querySelector('[role="list"]');
    if (list !== null) {
      list.scrollTop = 0;
    }
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

/** Click a row and return the time until the first frame after its content. */
async function openTicket(page, issueId, sentinel = null) {
  return page.evaluate(
    async ({ id, marker }) => {
      const row = document.querySelector(`[data-issue-id="${id}"]`);
      if (row === null) {
        throw new Error(`row ${id} is not rendered`);
      }
      const started = performance.now();
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((resolve, reject) => {
        const deadline = started + 10_000;
        const check = () => {
          const article = document.querySelector('article');
          const body = article?.querySelector('.markdown-body');
          const ready =
            article !== null &&
            (marker === null
              ? article.querySelector('h1') !== null
              : body?.textContent?.includes(marker) === true);
          if (ready) {
            requestAnimationFrame(() => resolve());
            return;
          }
          if (performance.now() > deadline) {
            reject(new Error(`detail ${id} did not render`));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
      return performance.now() - started;
    },
    { id: issueId, marker: sentinel }
  );
}

async function measureRun(browser, run) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(
      ({ projectId, workspaceName, records }) => {
        const workspace = {
          path: `/repo/${projectId}`,
          name: workspaceName,
          projectId,
          isWorktree: false,
          lastOpenedAt: '2026-11-01T00:00:00Z',
          checkpoint: null,
        };
        const snapshot = {
          config: {
            schemaVersion: 1,
            bdPath: null,
            language: 'en',
            theme: 'system',
            lastWorkspacePath: null,
            workspaces: [workspace],
          },
          missing: [],
          active: workspace.path,
          corruptBackup: null,
        };
        window.__invokeLog = [];
        window.__TAURI_INTERNALS__ = {
          invoke: async (command) => {
            window.__invokeLog.push(command);
            if (command === 'workspace_snapshot') return snapshot;
            if (command === 'bd_status') return { kind: 'ready', path: 'bd', version: '1.3.2' };
            throw new Error(`unexpected command: ${command}`);
          },
        };
        window.__BEADAZZLED_E2E__ = {
          issues: records,
          syncState: { kind: 'healthy', lastSeq: 1, lastEventAt: null },
        };
      },
      { projectId: 'p1', workspaceName: 'alpha', records: tickets() }
    );

    await page.goto(`http://localhost:${port}/#/w/p1/list`);
    await waitForList(page);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );

    // Warm the lazy detail chunk so the samples measure rendering only.
    await openTicket(page, 'bza-0');
    await backToList(page);
    await page.evaluate(() => {
      window.__invokeLog.length = 0;
    });

    const openSamples = [];
    for (const id of ['bza-2', 'bza-3', 'bza-4', 'bza-5', 'bza-6']) {
      openSamples.push(await openTicket(page, id));
      await backToList(page);
    }

    const markdownSamples = [];
    await scrollListToTop(page);
    const coldMarkdown = await openTicket(page, 'bza-1', SENTINEL);
    await backToList(page);
    for (let sample = 0; sample < 3; sample += 1) {
      await scrollListToTop(page);
      markdownSamples.push(await openTicket(page, 'bza-1', SENTINEL));
      await backToList(page);
    }

    const ipcCalls = await page.evaluate(() => [...window.__invokeLog]);
    return { run, openSamples, coldMarkdown, markdownSamples, ipcCalls };
  } finally {
    await page.close();
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function summary(values) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  port = resolvePort(process.env.NAV_PORT);
  if (!existsSync(viteBin)) {
    throw new Error(`vite not found at ${viteBin}; run npm install first`);
  }

  await rm(outDir, { recursive: true, force: true });
  build();

  let server;
  let browser;
  try {
    server = await serve();
    browser = await chromium.launch();
    const runs = [];
    for (let run = 1; run <= options.runs; run += 1) {
      runs.push(await measureRun(browser, run));
    }

    const open = summary(runs.flatMap((entry) => entry.openSamples));
    const markdown = summary(runs.flatMap((entry) => entry.markdownSamples));
    const coldMarkdown = summary(runs.map((entry) => entry.coldMarkdown));
    const ipcCalls = runs.flatMap((entry) => entry.ipcCalls);
    const result = {
      measuredAt: new Date().toISOString(),
      fixture: { issues: 1000, markdownBytes: 64 * 1024 },
      method: 'click -> first animation frame after the detail content is painted',
      budgets,
      runs: runs.map((entry) => ({
        run: entry.run,
        open: entry.openSamples.map(round),
        coldMarkdown: round(entry.coldMarkdown),
        markdown: entry.markdownSamples.map(round),
      })),
      open: { ...open, p50: round(open.p50), p95: round(open.p95), max: round(open.max) },
      markdown: {
        ...markdown,
        p50: round(markdown.p50),
        p95: round(markdown.p95),
        max: round(markdown.max),
      },
      coldMarkdown: {
        ...coldMarkdown,
        p50: round(coldMarkdown.p50),
        max: round(coldMarkdown.max),
      },
      ipcCalls,
      passed: ipcCalls.length === 0,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('detail navigation (production bundle, 1000 issues)\n');
      for (const run of result.runs) {
        console.log(
          `  run ${run.run}: open ${run.open.map((value) => value.toFixed(1)).join(', ')}ms; ` +
            `64 KiB cold ${run.coldMarkdown.toFixed(1)}ms, warm ${run.markdown
              .map((value) => value.toFixed(1))
              .join(', ')}ms`
        );
      }
      console.log(
        `  open: n=${open.count} p50=${result.open.p50.toFixed(1)}ms ` +
          `p95=${result.open.p95.toFixed(1)}ms max=${result.open.max.toFixed(
            1
          )}ms budget=${budgets.openP95}ms ${open.p95 <= budgets.openP95 ? 'PASS' : 'OVER'}`
      );
      console.log(
        `  64 KiB markdown (warm): n=${markdown.count} p50=${result.markdown.p50.toFixed(1)}ms ` +
          `p95=${result.markdown.p95.toFixed(1)}ms max=${result.markdown.max.toFixed(
            1
          )}ms budget=${budgets.markdownP50}ms (p50) ${
            markdown.p50 <= budgets.markdownP50 ? 'PASS' : 'OVER'
          }`
      );
      console.log(
        `  64 KiB markdown (first open): p50=${result.coldMarkdown.p50.toFixed(1)}ms max=${result.coldMarkdown.max.toFixed(1)}ms`
      );
      console.log(
        `  bd calls while opening: ${ipcCalls.length === 0 ? '0 (PASS)' : ipcCalls.join(', ')}`
      );
    }

    // Over-budget numbers are warn-level (see CONSTRAINTS); a bd call is not.
    process.exitCode = result.passed ? 0 : 1;
  } finally {
    await browser?.close();
    server?.kill();
    await rm(outDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`measure:navigation failed: ${error.message}`);
  process.exitCode = 1;
});
