// Shared plumbing for the scripts that drive the real desktop app.
//
// Both the memory measurement and the release E2E need the same four steps:
// build a throwaway bd workspace, point the release binary at an isolated
// config through BEADAZZLED_CONFIG_DIR, attach to the WebView2 instance over
// the DevTools protocol, and tear the whole thing down afterwards.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic tickets close to a real workspace; every one is unblocked. */
export function fixtureIssueLines(count) {
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(
      JSON.stringify({
        id: `mem-${String(index).padStart(4, '0')}`,
        title: `Memory fixture issue ${index}`,
        description: 'Fixture body for the release checks. '.repeat(8),
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
        dependency_count: 0,
        dependent_count: 0,
        comment_count: 0,
      })
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Creates a temporary workspace with `count` imported issues plus an isolated
 * app config and WebView2 profile. Returns the paths the launcher needs.
 */
export async function createFixture(base, { count = 1000, prefix = 'mem' } = {}) {
  const workspace = path.join(base, 'workspace');
  const configDir = path.join(base, 'config');
  const profile = path.join(base, 'profile');
  await mkdir(workspace, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(profile, { recursive: true });

  const init = spawnSync('bd', ['init', '--prefix', prefix], {
    cwd: workspace,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (init.status !== 0) {
    throw new Error(`bd init failed: ${init.stderr || init.stdout}`);
  }
  const fixtureFile = path.join(workspace, 'fixture.jsonl');
  await writeFile(fixtureFile, fixtureIssueLines(count), 'utf8');
  const imported = spawnSync('bd', ['import', 'fixture.jsonl'], {
    cwd: workspace,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 300_000,
  });
  if (imported.status !== 0) {
    throw new Error(`bd import failed: ${imported.stderr || imported.stdout}`);
  }

  const entry = {
    path: workspace,
    name: 'release-fixture',
    projectId: randomUUID(),
    isWorktree: false,
    lastOpenedAt: '2026-11-01T00:00:00Z',
    checkpoint: null,
  };
  await writeFile(
    path.join(configDir, 'config.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        bdPath: null,
        language: 'en',
        theme: 'light',
        lastWorkspacePath: workspace,
        workspaces: [entry],
      },
      null,
      2
    ),
    'utf8'
  );

  return { workspace, configDir, profile, projectId: entry.projectId };
}

export function launchApp({ exe, fixture, port }) {
  return spawn(exe, [], {
    env: {
      ...process.env,
      BEADAZZLED_CONFIG_DIR: fixture.configDir,
      WEBVIEW2_USER_DATA_FOLDER: fixture.profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitForDevTools(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error(`WebView2 DevTools did not listen on port ${port}`);
}

/** Attaches to the running WebView2 and returns its first page. */
export async function connectWebView(port, timeoutMs = 30_000) {
  await waitForDevTools(port, Date.now() + timeoutMs);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (context === undefined) {
    throw new Error('the WebView2 instance exposed no browser context');
  }
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 15_000 }));
  return { browser, context, page };
}

/** Working set of the app process and every WebView2 process on its profile. */
export function processMemoryBytes(pid, profile) {
  return processBreakdown(pid, profile).reduce((total, entry) => total + entry.bytes, 0);
}

/**
 * Per-process working set, so a budget miss can name the renderer, GPU process
 * or the host instead of one opaque total.
 */
export function processBreakdown(pid, profile) {
  const escaped = profile.replace(/'/g, "''");
  const script = [
    '$rows = @()',
    'try {',
    `  $app = Get-Process -Id ${pid} -ErrorAction Stop`,
    '  $rows += [pscustomobject]@{ pid = $app.Id; name = $app.ProcessName; type = "host"; bytes = [int64]$app.WorkingSet64 }',
    '} catch {}',
    'try {',
    '$wv = Get-CimInstance Win32_Process -Filter "Name=\'msedgewebview2.exe\'" | ' +
      `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') }`,
    '  foreach ($p in $wv) {',
    '    $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue',
    '    if ($proc) {',
    '      $type = "webview2"',
    "      if ($p.CommandLine -match '--type=([a-z-]+)') { $type = $matches[1] }",
    '      $rows += [pscustomobject]@{ pid = $proc.Id; name = $proc.ProcessName; type = $type; bytes = [int64]$proc.WorkingSet64 }',
    '    }',
    '  }',
    '} catch {}',
    '$rows | ConvertTo-Json -Compress',
  ].join('\n');

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  const text = (result.stdout ?? '').trim();
  if (text === '') {
    throw new Error(`could not read process memory: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const entries = rows
    .filter((row) => Number.isFinite(row.bytes) && row.bytes > 0)
    .map((row) => ({ pid: row.pid, name: row.name, type: row.type, bytes: row.bytes }));
  if (entries.length === 0) {
    throw new Error(`could not read process memory: ${result.stderr || result.stdout}`);
  }
  return entries;
}

/** Kills the app tree; taskkill can lose reparented WebView2 children. */
export async function stopApp(child, profile) {
  if (child?.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
  const escaped = profile.replace(/'/g, "''");
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'msedgewebview2.exe\'" | ' +
        `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | ` +
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ],
    { stdio: 'ignore', windowsHide: true }
  );
  await sleep(300);
}

export async function removeFixture(base, keep = false) {
  if (!keep) {
    await rm(base, { recursive: true, force: true }).catch(() => undefined);
  }
}

export { mkdtemp, tmpdir };
