#!/usr/bin/env node
/**
 * Measures scroll frame pacing of the production List or Board view.
 *
 * The E2E suite runs against the Vite dev server, where React's development
 * build roughly doubles the cost of mounting rows; timing it there measures the
 * toolchain, not the artifact we ship. This script builds the real production
 * bundle (with the e2e data seam compiled in via VITE_E2E=1), serves it with
 * `vite preview`, and drives a 1000-issue list (or each board column) in
 * Chromium.
 *
 * Each run scrolls a fixed distance per animation frame for two seconds and
 * records the gap between animation frames. Three scenarios cover a comfortable
 * reading speed (48px/frame), a fast wheel fling (240px/frame, ~6.7 new rows
 * per frame) and the steady speed while status groups are rendered. A 60Hz
 * display ticks every 16.7ms, so a median at that value means the list keeps
 * up, while p95 and the worst observed frame catch sustained stalls and long
 * tasks. Median-of-runs is reported for p50/p95; the max is the worst frame
 * across all runs, so one GC pause cannot hide behind the median.
 *
 * Usage: npm run measure:scroll -- [--runs=5] [--view=list|board] [--json]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { parseOptions, runMain } from './lib/cli.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-e2e');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
// 60Hz ticks at 16.7ms: a p50 near one frame keeps 60fps, p95 allows one
// extra frame, and max absorbs a single GC/compile pause.
const budgets = { p50: 18, p95: 22, max: 50 };
// Steady reading speed, a fast wheel fling, and the same steady speed with
// group headers in the window. 240px/frame mounts roughly 6.7 rows per frame,
// close to the low end of a real fling; 48px/frame is a comfortable read.
const scenarios = [
  { name: 'steady', delta: 48, steps: 120, group: 'none', from: 0, minDistance: 5_000 },
  { name: 'fling', delta: 240, steps: 150, group: 'none', from: 0, minDistance: 25_000 },
  // The open bucket runs to about 26,200px (624 rows x 42px), so start just
  // past it and travel far enough to finish at the bottom of the list, which
  // covers the remaining group headers instead of stopping mid-group.
  {
    name: 'grouped',
    delta: 48,
    steps: 330,
    group: 'status',
    from: 26_500,
    minDistance: 14_000,
    reachBottom: true,
  },
];
// The board virtualizes each column separately; Ready holds every open ticket
// (about 570 of the 1000-issue fixture) and is the column under test.
const boardScenarios = [
  {
    name: 'board-steady',
    view: 'board',
    column: 'ready',
    delta: 48,
    steps: 120,
    from: 0,
    minDistance: 5_000,
  },
  {
    name: 'board-fling',
    view: 'board',
    column: 'ready',
    delta: 240,
    steps: 150,
    from: 0,
    minDistance: 25_000,
  },
  // Blocked cards carry the extra chip row, so the blocked column is the
  // heaviest per-card case.
  {
    name: 'board-blocked',
    view: 'board',
    column: 'blocked',
    delta: 48,
    steps: 120,
    from: 0,
    minDistance: 3_000,
  },
];
let port = 1431;

function resolvePort(raw) {
  if (raw === undefined || raw === '') {
    return 1431;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error('SCROLL_PORT must be an integer between 1024 and 65535');
  }
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  return parseOptions(argv, {
    flags: ['--json'],
    values: ['--runs', '--view'],
    usage: () => 'Usage: npm run measure:scroll -- [--runs=5] [--view=list|board] [--json]',
    defaults: { runs: 5, json: false, view: 'list' },
    onFlag(opts, name) {
      if (name === '--json') {
        opts.json = true;
      }
    },
    onValue(opts, name, value) {
      if (name === '--runs') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--runs needs a positive integer');
        }
        opts.runs = parsed;
      } else if (name === '--view') {
        if (value !== 'list' && value !== 'board') {
          throw new Error('--view must be list or board');
        }
        opts.view = value;
      }
    },
  });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** A deterministic 1000-issue fixture close to a real workspace. */
function issues() {
  return Array.from({ length: 1000 }, (_, index) => ({
    id: `bza-${index}`,
    title: `Issue ${index}`,
    description: '',
    status:
      index % 11 === 0
        ? 'blocked'
        : index % 7 === 0
          ? 'closed'
          : index % 5 === 0
            ? 'in_progress'
            : 'open',
    priority: index % 5,
    issue_type: index % 3 === 0 ? 'bug' : 'task',
    assignee: index % 4 === 0 ? 'ada' : index % 4 === 1 ? 'lin' : undefined,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    labels: index % 2 === 0 ? ['ui'] : ['backend', 'perf', 'docs'],
    // Half the blocked cards also name a real blocker, so the chip renders the
    // dependency variant rather than only the manual one.
    dependency_count: index % 11 === 0 && index % 22 === 0 ? 1 : 0,
    dependencies:
      index % 11 === 0 && index % 22 === 0
        ? [
            {
              issue_id: `bza-${index}`,
              depends_on_id: 'bza-1',
              type: 'blocks',
              created_at: '2026-11-01T00:00:00Z',
            },
          ]
        : undefined,
    dependent_count: 0,
    comment_count: 0,
  }));
}

function build() {
  // Do not bake unrelated VITE_* values from the developer shell into the
  // benchmark bundle; only the seam flag is intentional.
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
  // Fail before spawning if something else already answers on the port; a
  // later 200 from a foreign server must never be mistaken for our preview.
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
    throw new Error(`port ${port} is already serving; set SCROLL_PORT to a free port`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('already serving')) {
      throw error;
    }
    // Nothing listening: expected.
  }

  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--outDir', 'dist-e2e', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: 'ignore' }
  );

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // A foreign service on this port would answer the probe; --strictPort
    // makes our own preview exit in that case. Detect that first.
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

async function measureRun(browser, scenario, run) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(
      ({ projectId, tickets }) => {
        const workspace = {
          path: `/repo/${projectId}`,
          name: 'alpha',
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
          issues: tickets,
          syncState: { kind: 'healthy', lastSeq: 1, lastEventAt: null },
        };
      },
      { projectId: 'p1', tickets: issues() }
    );

    const isBoard = scenario.view === 'board';
    const selector = isBoard
      ? `[data-column-id="${scenario.column}"] [role="list"]`
      : '[role="list"]';
    const query = scenario.group === 'none' ? '' : `?group=${scenario.group}`;
    await page.goto(`http://localhost:${port}/#/w/p1/${isBoard ? 'board' : `list${query}`}`);
    await page.waitForSelector(
      isBoard
        ? '[data-testid="board-view"][data-state="ready"]'
        : '[data-testid="list-view"][data-state="ready"]',
      { state: 'visible', timeout: 15_000 }
    );
    // Let the first paint and mount pass finish before sampling.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );

    const result = await page.evaluate(
      async ({ steps: count, delta: stepSize, from: start, selector }) => {
        const list = document.querySelector(selector);
        if (list === null) {
          throw new Error(`scroll container missing: ${selector}`);
        }
        // Jump to the scenario's starting point and let the window settle
        // before sampling, so a batch of row mounts is not counted as jank.
        list.scrollTop = start;
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const startScroll = list.scrollTop;

        const frames = [];
        let previous = performance.now();
        for (let step = 0; step < count; step += 1) {
          list.scrollTop += stepSize;
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          const now = performance.now();
          frames.push(now - previous);
          previous = now;
        }
        const endScroll = list.scrollTop;
        const maxScroll = list.scrollHeight - list.clientHeight;
        frames.sort((left, right) => left - right);
        return {
          p50: frames[Math.floor(frames.length * 0.5)],
          p95: frames[Math.floor(frames.length * 0.95)],
          max: frames[frames.length - 1],
          startScroll,
          endScroll,
          maxScroll,
          distance: endScroll - startScroll,
        };
      },
      { steps: scenario.steps, delta: scenario.delta, from: scenario.from, selector }
    );

    return { run, ...result };
  } finally {
    await page.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  port = resolvePort(process.env.SCROLL_PORT);
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
    const results = [];
    const selected = options.view === 'board' ? boardScenarios : scenarios;
    for (const scenario of selected) {
      const runs = [];
      for (let run = 1; run <= options.runs; run += 1) {
        runs.push(await measureRun(browser, scenario, run));
      }
      const summary = {
        scenario: scenario.name,
        view: scenario.view ?? 'list',
        delta: scenario.delta,
        steps: scenario.steps,
        group: scenario.group ?? null,
        column: scenario.column ?? null,
        from: scenario.from,
        runs,
        distance: runs[0]?.distance ?? 0,
        minDistance: scenario.minDistance,
        // A scenario that claims to cover the tail has to actually arrive
        // there, or the distance gate alone can pass in the middle of a group.
        reachedBottom:
          scenario.reachBottom !== true ||
          runs.every((entry) => entry.maxScroll - entry.endScroll <= 1),
        median: {
          p50: median(runs.map((entry) => entry.p50)),
          p95: median(runs.map((entry) => entry.p95)),
        },
        // Median-of-runs hides a single long GC or compile pause; gate the
        // worst frame actually observed as well.
        worstMax: Math.max(...runs.map((entry) => entry.max)),
      };
      summary.passed =
        summary.median.p50 < budgets.p50 &&
        summary.median.p95 < budgets.p95 &&
        summary.worstMax < budgets.max &&
        summary.distance >= summary.minDistance &&
        summary.reachedBottom;
      results.push(summary);
    }

    const passed = results.every((result) => result.passed);

    if (options.json) {
      console.log(JSON.stringify({ scenarios: results, budgets, passed }));
    } else {
      console.log('scroll frame pacing (production bundle, 1000 issues)\n');
      for (const result of results) {
        console.log(
          `  ${result.scenario}: ${result.delta}px/frame, ${
            result.view === 'board' ? `column=${result.column}` : `group=${result.group}`
          }, ${result.steps} frames, from ${result.from}px`
        );
        console.log('  run    p50      p95      max');
        for (const entry of result.runs) {
          console.log(
            `  ${String(entry.run).padStart(3)}  ${entry.p50.toFixed(1).padStart(6)}ms  ${entry.p95
              .toFixed(1)
              .padStart(6)}ms  ${entry.max.toFixed(1).padStart(6)}ms`
          );
        }
        console.log(
          `  median p50 ${result.median.p50.toFixed(1)}ms, p95 ${result.median.p95.toFixed(
            1
          )}ms; worst max ${result.worstMax.toFixed(
            1
          )}ms; travelled ${result.distance}px (min ${result.minDistance}px)${
            result.reachedBottom ? '' : '; stopped short of the tail'
          } — ${result.passed ? 'PASS' : 'FAIL'}\n`
        );
      }
      console.log(
        `  budget p50 < ${budgets.p50}ms, p95 < ${budgets.p95}ms, max < ${budgets.max}ms — ${
          passed ? 'PASS' : 'FAIL'
        }`
      );
    }

    process.exitCode = passed ? 0 : 1;
  } finally {
    await browser?.close();
    server?.kill();
    await rm(outDir, { recursive: true, force: true });
  }
}

runMain('measure:scroll failed', main);
