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
 * The 64 KiB body is judged twice, and the output labels both:
 * - first render (AC10): the first open of the long ticket in each fresh page,
 *   i.e. the cost a person actually pays the first time, JIT included;
 * - steady state: the same body reopened after that warm-up, which is what the
 *   renderer costs once nothing else is compiling.
 * AC10's ≤100ms budget is applied to the first-render p50; the steady-state
 * figure is reported against the same number as a reference, not as the
 * criterion.
 *
 * Usage: npm run measure:navigation -- [--runs=5] [--json]
 */
import { parseOptions, runMain } from './lib/cli.mjs';
import { resolvePort, withPreview } from './lib/prod-preview.mjs';
import { installSeam, makeIssue, makeIssues } from './lib/seam.mjs';
import { percentile, round } from './lib/startup-stats.mjs';

const budgets = { openP95: 50, markdownFirstRenderP50: 100, markdownSteadyStateP50: 100 };
const TS = '2026-11-01T00:00:00Z';
const SENTINEL = '64KIB-SENTINEL';

function parseArgs(argv) {
  return parseOptions(argv, {
    flags: ['--json'],
    values: ['--runs'],
    usage: () => 'Usage: node scripts/measure-navigation.mjs [--runs=N] [--json]',
    defaults: { runs: 5, json: false },
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
      }
    },
  });
}

function issue(id, overrides = {}) {
  return makeIssue(id, {
    description: 'A short **description** for this ticket.',
    ...overrides,
  });
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
  const list = makeIssues(1000, (index) => issue(`bza-${index}`));
  // Keep the long ticket near the top; the default sort orders by timestamp,
  // then id, so an id outside the sequence could land off-screen.
  list[1] = issue('bza-1', { description: bigDescription() });
  return list;
}

const TICKETS = tickets();

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

async function measureRun(browser, run, port) {
  const page = await browser.newPage();
  try {
    await installSeam(page, {
      projectId: 'p1',
      workspaceName: 'alpha',
      issues: TICKETS,
    });

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

function summary(values) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function summarizeNavigation(runs) {
  const open = summary(runs.flatMap((entry) => entry.openSamples));
  const steadyState = summary(runs.flatMap((entry) => entry.markdownSamples));
  const firstRender = summary(runs.map((entry) => entry.coldMarkdown));
  const ipcCalls = runs.flatMap((entry) => entry.ipcCalls);
  const verdict = {
    open: open.p95 <= budgets.openP95 ? 'PASS' : 'OVER',
    firstRender: firstRender.p50 <= budgets.markdownFirstRenderP50 ? 'PASS' : 'OVER',
    steadyState: steadyState.p50 <= budgets.markdownSteadyStateP50 ? 'PASS' : 'OVER',
  };
  return {
    measuredAt: new Date().toISOString(),
    fixture: { issues: 1000, markdownBytes: 64 * 1024 },
    method: 'click -> first animation frame after the detail content is painted',
    budgets,
    criteria: {
      open: 'P95 of opening a ticket from the list',
      firstRender: 'P50 of the first 64 KiB render in a fresh page (AC10)',
      steadyState: 'P50 of reopening the 64 KiB body after its warm-up (reference)',
    },
    runs: runs.map((entry) => ({
      run: entry.run,
      open: entry.openSamples.map(round),
      firstRender: round(entry.coldMarkdown),
      steadyState: entry.markdownSamples.map(round),
    })),
    open: { ...open, p50: round(open.p50), p95: round(open.p95), max: round(open.max) },
    firstRender: {
      ...firstRender,
      p50: round(firstRender.p50),
      p95: round(firstRender.p95),
      max: round(firstRender.max),
    },
    steadyState: {
      ...steadyState,
      p50: round(steadyState.p50),
      p95: round(steadyState.p95),
      max: round(steadyState.max),
    },
    verdict,
    ipcCalls,
    passed: ipcCalls.length === 0,
  };
}

function printReport(result) {
  console.log('detail navigation (production bundle, 1000 issues)\n');
  for (const run of result.runs) {
    console.log(
      `  run ${run.run}: open ${run.open.map((value) => value.toFixed(1)).join(', ')}ms; ` +
        `64 KiB first render ${run.firstRender.toFixed(1)}ms, ` +
        `steady state ${run.steadyState.map((value) => value.toFixed(1)).join(', ')}ms`
    );
  }
  console.log(
    `  open: n=${result.open.count} p50=${result.open.p50.toFixed(1)}ms ` +
      `p95=${result.open.p95.toFixed(1)}ms max=${result.open.max.toFixed(
        1
      )}ms budget=${budgets.openP95}ms (p95) ${result.verdict.open}`
  );
  console.log(
    `  64 KiB first render (AC10): n=${result.firstRender.count} p50=${result.firstRender.p50.toFixed(
      1
    )}ms p95=${result.firstRender.p95.toFixed(1)}ms max=${result.firstRender.max.toFixed(
      1
    )}ms budget=${budgets.markdownFirstRenderP50}ms (p50) ${result.verdict.firstRender}`
  );
  console.log(
    `  64 KiB steady state: n=${result.steadyState.count} p50=${result.steadyState.p50.toFixed(
      1
    )}ms p95=${result.steadyState.p95.toFixed(1)}ms max=${result.steadyState.max.toFixed(
      1
    )}ms budget=${budgets.markdownSteadyStateP50}ms (p50, reference) ${result.verdict.steadyState}`
  );
  console.log(
    `  bd calls while opening: ${result.ipcCalls.length === 0 ? '0 (PASS)' : result.ipcCalls.join(', ')}`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const port = resolvePort(process.env.NAV_PORT, { envName: 'NAV_PORT', defaultPort: 1432 });

  await withPreview({ port, envName: 'NAV_PORT' }, async ({ browser }) => {
    const runs = [];
    for (let run = 1; run <= options.runs; run += 1) {
      runs.push(await measureRun(browser, run, port));
    }

    const result = summarizeNavigation(runs);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printReport(result);
    }

    // Over-budget numbers are warn-level (see CONSTRAINTS); a bd call is not.
    process.exitCode = result.passed ? 0 : 1;
  });
}

runMain('measure:navigation failed', main);
