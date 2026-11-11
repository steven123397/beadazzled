#!/usr/bin/env node
/**
 * Three release checks against the real binary and a real bd workspace.
 *
 * Unlike tests/e2e (which run the web bundle against a fake bridge), this
 * launches the release executable, points it at a temporary bd database, and
 * drives the actual WebView2 over the DevTools protocol:
 *
 *   1. launch -> list -> open an issue
 *   2. read the issue body
 *   3. change the status and confirm bd persisted it
 *
 * The launch checks run against the release executable. With `--installer
 * <exe>` the script first installs the NSIS package silently, runs the three
 * checks on the installed binary, and uninstalls at the end; the interactive
 * wizard and the SmartScreen prompt remain manual evidence steps.
 *
 * Usage: npm run e2e:real -- [--exe <path>] [--installer <path>] [--port=1435] [--keep]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  connectWebView,
  createFixture,
  launchApp,
  mkdtemp,
  removeFixture,
  sleep,
  stopApp,
  tmpdir,
} from './lib/desktop-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultExe = path.join(root, 'src-tauri/target/release/beadazzled.exe');
const TARGET_ID = 'mem-0001';
const TARGET_TITLE = 'Memory fixture issue 1';

function usage() {
  return [
    'Usage: node scripts/e2e-real.mjs [options]',
    '',
    '  --exe <path>   application binary (default src-tauri/target/release/beadazzled.exe)',
    '  --installer <path>  install this NSIS package first, then test the installed app',
    '  --force-install     allow --installer to upgrade an existing beadazzled install',
    '  --port <n>     DevTools port for the WebView2 instance (default 1435)',
    '  --keep         keep the temporary workspace and profile for inspection',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    exe: defaultExe,
    installer: null,
    port: 1435,
    keep: false,
    forceInstall: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const inline = separator === -1 ? undefined : arg.slice(separator + 1);
    if (name === '--keep') {
      options.keep = true;
    } else if (name === '--force-install') {
      options.forceInstall = true;
    } else if (name === '--help' || name === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (name === '--exe' || name === '--port' || name === '--installer') {
      const value = inline ?? argv[(index += 1)];
      if (value === undefined || value === '') {
        throw new Error(`${name} needs a value`);
      }
      if (name === '--exe') {
        options.exe = path.resolve(value);
      } else if (name === '--installer') {
        options.installer = path.resolve(value);
      } else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1) {
          throw new Error('--port needs a positive integer');
        }
        options.port = port;
      }
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

/** An existing per-user install, read from the uninstall registry key. */
function installedApp() {
  const script = [
    "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |",
    "Where-Object { $_.DisplayName -eq 'beadazzled' } |",
    'Select-Object DisplayVersion,InstallLocation | ConvertTo-Json -Compress',
  ].join(' ');
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
    return null;
  }
  const parsed = JSON.parse(text);
  const location = typeof parsed.InstallLocation === 'string' ? parsed.InstallLocation : '';
  return {
    version: typeof parsed.DisplayVersion === 'string' ? parsed.DisplayVersion : 'unknown',
    dir: location.replace(/^"|"$/g, ''),
  };
}

/** Silent currentUser install; returns the installed exe and its directory. */
async function installApp(installer, { force = false } = {}) {
  if (!existsSync(installer)) {
    throw new Error(`installer not found: ${installer}`);
  }
  // NSIS reuses the previous install location, so running this on a machine
  // that already has beadazzled upgrades the user's copy instead of creating
  // the throwaway one the test expects. Refuse unless that is intended.
  const existing = installedApp();
  if (existing !== null && !force) {
    throw new Error(
      `beadazzled ${existing.version} is already installed at ${existing.dir || '(unknown)'}; ` +
        'this test would upgrade it. Uninstall it first, or pass --force-install.'
    );
  }
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    existing?.dir,
    path.join(localAppData, 'beadazzled'),
    path.join(localAppData, 'Programs', 'beadazzled'),
  ].filter((dir) => typeof dir === 'string' && dir !== '');

  const result = spawnSync(installer, ['/S'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`installer exited with ${result.status ?? 'a signal'}`);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const dir of candidates) {
      const exe = path.join(dir, 'beadazzled.exe');
      if (existsSync(exe)) {
        return { exe, dir };
      }
    }
    await sleep(200);
  }
  throw new Error(`the installer did not place beadazzled.exe in ${candidates.join(', ')}`);
}

async function uninstallApp(dir) {
  const uninstaller = path.join(dir, 'uninstall.exe');
  if (!existsSync(uninstaller)) {
    throw new Error(`no uninstaller at ${uninstaller}`);
  }
  spawnSync(uninstaller, ['/S'], { stdio: 'ignore', windowsHide: true, timeout: 120_000 });
  // NSIS copies the uninstaller to temp and returns immediately.
  const exe = path.join(dir, 'beadazzled.exe');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && existsSync(exe)) {
    await sleep(200);
  }
  if (existsSync(exe)) {
    throw new Error('uninstall did not remove the installed executable within 60s');
  }
}

function statusFromBd(workspace, id) {
  const result = spawnSync('bd', ['show', id, '--json'], {
    cwd: workspace,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`bd show ${id} failed: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  const issue = Array.isArray(parsed) ? parsed[0] : parsed;
  return issue?.status ?? null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const base = await mkdtemp(path.join(tmpdir(), 'beadazzled-e2e-'));
  let child = null;
  let browser = null;
  let installed = null;

  try {
    if (options.installer !== null) {
      installed = await installApp(options.installer, { force: options.forceInstall });
      options.exe = installed.exe;
      console.log(`PASS installer -> ${installed.exe}`);
    }
    if (!existsSync(options.exe)) {
      throw new Error(`release binary not found at ${options.exe}; run npm run build:app first`);
    }

    const fixture = await createFixture(base, { count: 20, prefix: 'e2e' });
    child = launchApp({ exe: options.exe, fixture, port: options.port });
    const attached = await connectWebView(options.port);
    browser = attached.browser;
    const page = attached.page;

    // 1. launch -> list -> detail
    await page.waitForSelector('[data-testid="list-view"][data-state="ready"]', {
      state: 'visible',
      timeout: 30_000,
    });
    const rows = await page.locator('[role="list"] [data-issue-id]').count();
    if (rows === 0) {
      throw new Error('the list rendered no rows');
    }
    console.log(`PASS launch -> list (${rows} rendered rows)`);

    await page.getByLabel('Search tickets').fill(TARGET_TITLE);
    const row = page.locator(`[data-issue-id="${TARGET_ID}"]`);
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    await row.click();
    await page
      .locator('h1')
      .filter({ hasText: TARGET_TITLE })
      .waitFor({ state: 'visible', timeout: 15_000 });
    console.log(`PASS list -> detail (${TARGET_ID})`);

    // 2. read the body
    await page
      .getByText('Fixture body for the release checks.', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });
    console.log('PASS detail body renders');

    // 3. change the status and wait for bd to persist it
    await page.getByLabel(/^Status: /).click();
    await page.getByRole('radio', { name: 'In progress' }).click();
    await page.getByLabel('Status: In progress').waitFor({ state: 'visible', timeout: 15_000 });

    const deadline = Date.now() + 15_000;
    let status = null;
    while (Date.now() < deadline) {
      status = statusFromBd(fixture.workspace, TARGET_ID);
      if (status === 'in_progress') {
        break;
      }
      await sleep(250);
    }
    if (status !== 'in_progress') {
      throw new Error(`bd reports status ${status ?? '(none)'} instead of in_progress`);
    }
    console.log('PASS status change persists in bd');

    console.log('\ne2e:real — 3/3 passed');
  } finally {
    try {
      await browser?.close();
    } catch {
      // The window may already be gone.
    }
    if (child !== null) {
      await stopApp(child, path.join(base, 'profile'));
    }
    await removeFixture(base, options.keep);
    if (options.keep) {
      console.log(`kept ${base}`);
    }
    if (installed !== null) {
      await uninstallApp(installed.dir);
      console.log('PASS uninstall removes the installed executable');
    }
  }
}

main().catch((error) => {
  console.error(`e2e:real failed: ${error.message}`);
  process.exitCode = 1;
});
