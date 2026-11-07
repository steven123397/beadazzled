#!/usr/bin/env node
/**
 * Measures resident memory of the release app with a 1000-issue workspace.
 *
 * The number that matters for a desktop app is the working set of the process
 * tree, not one renderer's JavaScript heap: WebView2 splits work across several
 * processes. This script launches the real release binary, points it at a
 * temporary bd workspace through `BEADAZZLED_CONFIG_DIR`, attaches to the
 * WebView2 instance over the DevTools protocol, waits until the list is ready,
 * and sums the working set of beadazzled.exe plus every msedgewebview2.exe
 * process using the measurement profile.
 *
 * WebView2's fixed cost (browser, GPU, renderer and utility processes) dominates
 * the total on every launch. A single number therefore says little about this
 * app: the script also measures a one-issue baseline and reports the growth
 * caused by 1000 tickets, which is the part app code can regress.
 *
 * Usage: npm run measure:memory -- [--runs=5] [--issues=1000] [--json]
 *
 * Requires: a release binary (`npm run build:app`), bd on PATH, Playwright.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOptions, runMain } from './lib/cli.mjs';
import { DEFAULT_RELEASE_EXE_REL, releaseExe } from './lib/paths.mjs';
import { median } from './lib/startup-stats.mjs';

import {
  connectWebView,
  createFixture,
  launchApp,
  mkdtemp,
  processBreakdown,
  processMemoryBytes,
  removeFixture,
  sleep,
  stopApp,
  tmpdir,
} from './lib/desktop-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultExe = releaseExe(root);
// Budgets are recorded in ADR-0011. WebView2's process tree is ~430 MB before
// any ticket is loaded on the reference machine; the data-growth budget is what
// catches a regression in the app itself.
const TOTAL_BUDGET_BYTES = 600 * 1024 * 1024;
const GROWTH_BUDGET_BYTES = 50 * 1024 * 1024;
const BASELINE_ISSUES = 1;
const BASELINE_RUNS = 2;

function usage() {
  return [
    'Usage: node scripts/measure-memory.mjs [options]',
    '',
    '  --runs <n>     samples at the target size (default 5, median reported)',
    '  --issues <n>   fixture size (default 1000)',
    `  --exe <path>   application binary (default ${DEFAULT_RELEASE_EXE_REL})`,
    '  --port <n>     DevTools port for the WebView2 instance (default 1434)',
    '  --json         print the machine-readable result instead of a report',
    '  --keep         keep the temporary workspaces and profiles for inspection',
  ].join('\n');
}

function parseArgs(argv) {
  return parseOptions(argv, {
    flags: ['--json', '--keep'],
    values: ['--runs', '--port', '--exe', '--issues'],
    usage,
    defaults: { runs: 5, exe: defaultExe, port: 1434, json: false, keep: false, issues: 1000 },
    onFlag(opts, name) {
      if (name === '--json') {
        opts.json = true;
      } else if (name === '--keep') {
        opts.keep = true;
      }
    },
    onValue(opts, name, value) {
      if (name === '--exe') {
        opts.exe = path.resolve(value);
        return;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${name} needs a positive integer`);
      }
      if (name === '--runs') {
        opts.runs = parsed;
      } else if (name === '--issues') {
        opts.issues = parsed;
      } else {
        opts.port = parsed;
      }
    },
  });
}

async function sampleFixture({ exe, base, port, count, prefix, runs }) {
  const fixture = await createFixture(base, { count, prefix });
  let child = null;
  let browser = null;
  try {
    child = launchApp({ exe, fixture, port });
    const attached = await connectWebView(port);
    browser = attached.browser;
    const page = attached.page;
    await page.waitForSelector('[data-testid="list-view"][data-state="ready"]', {
      state: 'visible',
      timeout: 30_000,
    });
    const rows = await page.locator('[role="list"] [data-issue-id]').count();
    if (rows === 0) {
      throw new Error('the list rendered no rows; the fixture workspace did not load');
    }

    const session = await attached.context.newCDPSession(page);
    await session.send('Performance.enable');

    const samples = [];
    for (let run = 1; run <= runs; run += 1) {
      await session.send('HeapProfiler.collectGarbage').catch(() => undefined);
      const metrics = await session.send('Performance.getMetrics');
      const metric = (name) => metrics.metrics.find((entry) => entry.name === name)?.value ?? 0;
      const sample = {
        processBytes: processMemoryBytes(child.pid, fixture.profile),
        heapBytes: metric('JSHeapUsedSize'),
        nodes: metric('Nodes'),
      };
      samples.push(sample);
      await sleep(1000);
    }

    return {
      rows,
      samples,
      breakdown: processBreakdown(child.pid, fixture.profile),
    };
  } finally {
    try {
      await browser?.close();
    } catch {
      // The window may already be gone.
    }
    if (child !== null) {
      await stopApp(child, fixture.profile);
    }
  }
}

function summarizeMemory(options, baseline, target) {
  const baselineBytes = median(baseline.samples.map((sample) => sample.processBytes));
  const targetBytes = median(target.samples.map((sample) => sample.processBytes));
  const growthBytes = targetBytes - baselineBytes;
  const heapBytes = median(target.samples.map((sample) => sample.heapBytes));
  const nodes = median(target.samples.map((sample) => sample.nodes));

  const result = {
    issues: options.issues,
    rows: target.rows,
    baseline: { issues: BASELINE_ISSUES, bytes: baselineBytes },
    target: { bytes: targetBytes, heapBytes, nodes },
    growthBytes,
    budgets: { totalBytes: TOTAL_BUDGET_BYTES, growthBytes: GROWTH_BUDGET_BYTES },
    runs: target.samples,
    breakdown: target.breakdown,
  };
  result.passed = targetBytes <= TOTAL_BUDGET_BYTES && growthBytes <= GROWTH_BUDGET_BYTES;
  return result;
}

function printReport(result) {
  console.log(
    `baseline (${result.baseline.issues} issue): ${(result.baseline.bytes / 1024 / 1024).toFixed(1)} MB`
  );
  console.log(
    `${result.issues} issues: ${(result.target.bytes / 1024 / 1024).toFixed(1)} MB ` +
      `(budget ${(TOTAL_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB), ` +
      `JS heap ${(result.target.heapBytes / 1024 / 1024).toFixed(1)} MB, ${Math.round(result.target.nodes)} DOM nodes`
  );
  console.log(
    `data growth: ${result.growthBytes >= 0 ? '+' : ''}${(result.growthBytes / 1024 / 1024).toFixed(1)} MB ` +
      `(budget +${(GROWTH_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB) — ` +
      `${result.passed ? 'PASS' : 'OVER'}`
  );
  const byType = new Map();
  for (const entry of result.breakdown) {
    byType.set(entry.type, (byType.get(entry.type) ?? 0) + entry.bytes);
  }
  console.log(
    'breakdown: ' +
      [...byType.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([type, bytes]) => `${type} ${(bytes / 1024 / 1024).toFixed(1)} MB`)
        .join(' · ')
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.exe)) {
    throw new Error(`release binary not found at ${options.exe}; run npm run build:app first`);
  }

  const base = await mkdtemp(path.join(tmpdir(), 'beadazzled-memory-'));
  try {
    const baseline = await sampleFixture({
      exe: options.exe,
      base: path.join(base, 'baseline'),
      port: options.port,
      count: BASELINE_ISSUES,
      prefix: 'memb',
      runs: BASELINE_RUNS,
    });
    const target = await sampleFixture({
      exe: options.exe,
      base: path.join(base, 'target'),
      port: options.port,
      count: options.issues,
      prefix: 'mem',
      runs: options.runs,
    });

    const result = summarizeMemory(options, baseline, target);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printReport(result);
    }
    process.exitCode = result.passed ? 0 : 1;
  } finally {
    await removeFixture(base, options.keep);
    if (options.keep) {
      console.log(`kept ${base}`);
    }
  }
}

runMain('measure:memory failed', main);
