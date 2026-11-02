#!/usr/bin/env node
/**
 * Measures cold and warm startup of the real Tauri app.
 *
 * Each launch asks the Rust side to leave a timestamp when WebView2 finishes
 * loading the page (`on_page_load` -> NavigationCompleted). That is when the
 * shell has been parsed and its module scripts have run; the first React commit
 * follows by roughly 60ms on the current build (calibrated in the report in
 * docs/measurements). Unlike the DevTools protocol, this marker adds no
 * measurable overhead to the launch being measured.
 *
 * Cold runs use a fresh WEBVIEW2_USER_DATA_FOLDER per launch, so they pay for
 * profile creation the way a first launch after installation does. Warm runs
 * reuse one profile. The OS file cache is naturally warm on a developer
 * machine, so cold numbers here are a lower bound for a true post-reboot start.
 *
 * Usage: npm run measure:startup -- [--runs=10] [--warm-runs=10] [--json]
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarize } from './lib/startup-stats.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultExe = path.join(root, 'src-tauri/target/release/beadazzled.exe');
const budgets = { coldP95: 2000, warmP95: 800 };
const TRACE_PREFIX = 'page-load-finished';
// Inputs whose change makes an existing binary unrepresentative. `dist` is
// included because `tauri build` copies it into the exe.
const SOURCE_DIRECTORIES = ['src', 'src-tauri/src', 'dist'];
const SOURCE_FILES = ['index.html', 'vite.config.ts', 'src-tauri/tauri.conf.json'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function usage() {
  return [
    'Usage: node scripts/measure-startup.mjs [options]',
    '',
    '  --runs <n>        cold launches to measure (default 20)',
    '  --warm-runs <n>   warm launches to measure (default 20)',
    '  --exe <path>      application binary (default src-tauri/target/release/beadazzled.exe)',
    '  --timeout <ms>    per-launch timeout (default 20000)',
    '  --no-build        fail instead of building a missing release binary',
    '  --json            print the machine-readable result instead of a report',
    '',
    'P95 uses nearest-rank: the sample at position ceil(0.95 * n). Below n=20',
    'that position is the maximum, so smaller runs are a smoke test, not a budget',
    'measurement. The app shares its config directory with the installed app, so',
    'the active workspace is recorded (not isolated) and reported as a warning.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    runs: 20,
    warmRuns: 20,
    exe: defaultExe,
    timeout: 20_000,
    build: true,
    json: false,
  };

  const valueOptions = new Set(['--runs', '--warm-runs', '--exe', '--timeout']);
  const flagOptions = new Set(['--no-build', '--json']);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // Split on the first '=' only: a Windows path such as --exe=C:\a=b\app.exe
    // would otherwise be truncated at the second one.
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const inline = separator === -1 ? undefined : arg.slice(separator + 1);

    if (flagOptions.has(name)) {
      if (name === '--no-build') {
        options.build = false;
      } else {
        options.json = true;
      }
      continue;
    }

    if (name === '--help' || name === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (!valueOptions.has(name)) {
      throw new Error(`unknown option: ${arg}\n\n${usage()}`);
    }

    const value = inline ?? argv[++index];
    if (value === undefined) {
      throw new Error(`${name} needs a value`);
    }

    switch (name) {
      case '--runs':
        options.runs = Number(value);
        break;
      case '--warm-runs':
        options.warmRuns = Number(value);
        break;
      case '--exe':
        options.exe = path.resolve(value);
        break;
      case '--timeout':
        options.timeout = Number(value);
        break;
    }
  }

  for (const name of ['runs', 'warmRuns']) {
    if (!Number.isInteger(options[name]) || options[name] < 0) {
      throw new Error(`--${name === 'runs' ? 'runs' : 'warm-runs'} needs a non-negative integer`);
    }
  }
  if (options.runs === 0 && options.warmRuns === 0) {
    throw new Error('nothing to measure: both --runs and --warm-runs are zero');
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 1000) {
    throw new Error('--timeout needs at least 1000ms');
  }

  return options;
}

/**
 * Builds the release binary. In `--json` mode the child inherits stderr, never
 * stdout, so cargo/tauri logs cannot corrupt the machine-readable result.
 */
function buildRelease(quiet) {
  const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
  if (!existsSync(cli)) {
    throw new Error('cannot build: @tauri-apps/cli is not installed (run npm install)');
  }

  const result = spawnSync(process.execPath, [cli, 'build', '--no-bundle'], {
    cwd: root,
    stdio: quiet ? ['ignore', 2, 2] : 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error('tauri build --no-bundle failed');
  }
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Newest file among the build inputs, so a stale binary can name what changed. */
function newestSource() {
  let newest = { path: null, mtimeMs: 0 };

  const consider = (absolutePath) => {
    try {
      const stats = statSync(absolutePath);
      if (stats.mtimeMs > newest.mtimeMs) {
        newest = {
          path: path.relative(root, absolutePath).split(path.sep).join('/'),
          mtimeMs: stats.mtimeMs,
        };
      }
    } catch {
      // A missing optional input is not a staleness signal.
    }
  };

  const walk = (absoluteDirectory) => {
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && !/\.test\.[jt]sx?$/.test(entry.name)) {
        // Tests never reach the bundle, so they cannot make a binary stale.
        consider(absolutePath);
      }
    }
  };

  for (const directory of SOURCE_DIRECTORIES) {
    walk(path.join(root, directory));
  }
  for (const file of SOURCE_FILES) {
    consider(path.join(root, file));
  }

  return newest;
}

/**
 * Which commit and binary this run measured, and whether the binary predates
 * its inputs. Reporting a stale binary is the difference between a budget
 * number and a number for code that no longer exists.
 */
async function describeFreshness(exe, exeStat) {
  const head = gitValue(['rev-parse', 'HEAD']);
  const newest = newestSource();
  const reasons = [];

  // Compare against the inputs, not the commit date: committing right after a
  // build is normal, and treating that as stale would train readers to ignore
  // the warning. A checkout or an edit bumps input mtimes, which is the signal
  // that actually means "this binary is older than the code".
  if (newest.path !== null && newest.mtimeMs > exeStat.mtimeMs) {
    reasons.push(`binary is older than ${newest.path}`);
  }

  return {
    gitHead: head,
    gitDirty: gitValue(['status', '--porcelain']) !== '',
    binaryModifiedAt: new Date(exeStat.mtimeMs).toISOString(),
    binarySha256: createHash('sha256')
      .update(await readFile(exe))
      .digest('hex'),
    stale: reasons.length > 0,
    reasons,
  };
}

/**
 * The app reads its workspace registry from its own config directory, which is
 * shared with the installed app. Isolating it would need a relocation command
 * the app does not have yet, so the state is recorded instead and reported as a
 * warning: an active workspace adds export work to every sample.
 */
function describeAppConfig() {
  let identifier = 'com.steven123397.beadazzled';
  try {
    const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    if (typeof config.identifier === 'string') {
      identifier = config.identifier;
    }
  } catch {
    // Fall back to the current identifier.
  }

  const directory =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? path.join(tmpdir(), 'appdata'), identifier)
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(tmpdir(), '.config'), identifier);
  const configPath = path.join(directory, 'config.json');

  try {
    const stats = statSync(configPath);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return {
      path: configPath,
      isolated: false,
      exists: true,
      bytes: stats.size,
      modifiedAt: new Date(stats.mtimeMs).toISOString(),
      workspaceCount: Array.isArray(config.workspaces) ? config.workspaces.length : 0,
      activeWorkspace: config.lastWorkspacePath ?? null,
    };
  } catch {
    return { path: configPath, isolated: false, exists: false };
  }
}

async function readTrace(traceFile) {
  try {
    const contents = await readFile(traceFile, 'utf8');
    const pattern = new RegExp(`^${TRACE_PREFIX} (\\d+) (\\S+)$`, 'gm');
    for (const match of contents.matchAll(pattern)) {
      if (!match[2].startsWith('about:')) {
        return Number(match[1]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function measureOnce({ exe, profile, traceFile, timeout }) {
  const started = performance.now();
  const spawnEpoch = Date.now();
  const deadline = started + timeout;
  let child = null;

  try {
    await unlink(traceFile).catch(() => undefined);
    await writeFile(traceFile, '', 'utf8');

    child = spawn(exe, [], {
      env: {
        ...process.env,
        BEADAZZLED_STARTUP_TRACE: traceFile,
        WEBVIEW2_USER_DATA_FOLDER: profile,
      },
      stdio: 'ignore',
      windowsHide: true,
    });

    while (performance.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`app exited with code ${child.exitCode} before page load finished`);
      }
      const finishedAt = await readTrace(traceFile);
      if (finishedAt !== null) {
        return { elapsedMs: finishedAt - spawnEpoch };
      }
      await sleep(2);
    }

    throw new Error(`page load did not finish within ${timeout}ms`);
  } finally {
    await stop(child);
    await cleanupWebView2(profile);
  }
}

async function stop(child) {
  if (child === null || child.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => child.once('exit', resolve));
  const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await Promise.race([
    Promise.all([exited, new Promise((resolve) => killer.once('exit', resolve))]),
    sleep(5000),
  ]);
}

/**
 * taskkill sometimes loses WebView2 children that have been reparented. The
 * profile path is unique to this measurement, so matching it is safe even if
 * another beadazzled window is open.
 */
async function cleanupWebView2(profile) {
  const escaped = profile.replace(/'/g, "''");
  const script =
    'Get-CimInstance Win32_Process -Filter "Name=\'msedgewebview2.exe\'" | ' +
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | ` +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';

  await new Promise((resolve) => {
    const shell = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    shell.once('exit', resolve);
    shell.once('error', () => resolve());
  });
  await sleep(200);
}

async function freshProfile() {
  return mkdtemp(path.join(tmpdir(), 'beadazzled-startup-'));
}

async function removeProfile(profile) {
  // WebView2 keeps a few files mapped briefly after the host process exits.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300);
    }
  }
  console.warn(`could not remove ${profile}; it will be left in the temp directory`);
}

async function runBatch(label, count, options, profileFactory, traceDir) {
  const samples = [];

  for (let index = 0; index < count; index += 1) {
    const profile = await profileFactory(index);
    const traceFile = path.join(traceDir, `${label}-${index}.trace`);
    try {
      const result = await measureOnce({
        exe: options.exe,
        profile,
        traceFile,
        timeout: options.timeout,
      });
      samples.push(result.elapsedMs);
      if (!options.json) {
        console.log(`${label} run ${index + 1}/${count}: ${Math.round(result.elapsedMs)}ms`);
      }
    } finally {
      await sleep(350);
      if (label === 'cold') {
        await removeProfile(profile);
      }
    }
  }

  return samples;
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('startup measurement targets the Windows WebView2 app');
  }

  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.exe)) {
    if (!options.build) {
      throw new Error(
        `missing ${options.exe}; run "npx tauri build --no-bundle" or drop --no-build`
      );
    }
    if (!options.json) {
      console.log('release binary missing; building with "tauri build --no-bundle"');
    }
    buildRelease(options.json);
  }
  if (!existsSync(options.exe)) {
    throw new Error(`build finished without producing ${options.exe}`);
  }

  const exeStat = statSync(options.exe);
  // Judge freshness before spending minutes on launches: measuring a binary
  // that predates its sources produces a number for code nobody ships.
  const freshness = await describeFreshness(options.exe, exeStat);
  const appConfig = describeAppConfig();
  const traceDir = await freshProfile();

  try {
    if (!options.json) {
      console.log(`binary: ${options.exe} (${(exeStat.size / 1024 / 1024).toFixed(1)} MB)`);
      console.log(`git: ${freshness.gitHead ?? 'unknown'}${freshness.gitDirty ? ' (dirty)' : ''}`);
      console.log(`config: ${appConfig.path}${appConfig.exists ? '' : ' (missing)'}`);
      if (freshness.stale) {
        console.warn(`warning: the binary may be stale — ${freshness.reasons.join('; ')}`);
      }
    }

    const cold =
      options.runs === 0
        ? null
        : await runBatch('cold', options.runs, options, async () => freshProfile(), traceDir);

    // Prime one profile so warm runs start from the same WebView2 state a user
    // has after the app has opened at least once.
    const warmProfile = options.warmRuns === 0 ? null : await freshProfile();
    try {
      let warm = null;
      if (warmProfile !== null) {
        const priming = await measureOnce({
          exe: options.exe,
          profile: warmProfile,
          traceFile: path.join(traceDir, 'warm-up.trace'),
          timeout: options.timeout,
        });
        if (!options.json) {
          console.log(`warm-up run: ${Math.round(priming.elapsedMs)}ms (not counted)`);
        }
        warm = await runBatch('warm', options.warmRuns, options, async () => warmProfile, traceDir);
      }

      const coldSummary = cold === null ? null : summarize(cold);
      const warmSummary = warm === null ? null : summarize(warm);
      const result = {
        measuredAt: new Date().toISOString(),
        binary: options.exe,
        binaryBytes: exeStat.size,
        platform: process.platform,
        probe: 'WebView2 NavigationCompleted (page load finished)',
        p95Method: 'nearest-rank: ceil(0.95 * n)',
        budgets,
        cold: coldSummary,
        warm: warmSummary,
        coldSamples: cold === null ? [] : cold.map(round),
        warmSamples: warm === null ? [] : warm.map(round),
        freshness,
        appConfig,
        warnings: collectWarnings(freshness, appConfig, coldSummary, warmSummary),
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printReport(result);
      }

      // Startup budgets are measurement-only (warn), so overruns do not fail
      // the process. Deterministic failures already throw above.
    } finally {
      if (warmProfile !== null) {
        await removeProfile(warmProfile);
      }
    }
  } finally {
    await removeProfile(traceDir);
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Everything a reader must know before treating the numbers as a budget
 * measurement. Warnings are informational: startup budgets are warn-level.
 */
function collectWarnings(freshness, appConfig, cold, warm) {
  const warnings = [];

  if (freshness.stale) {
    warnings.push(`the binary may be stale: ${freshness.reasons.join('; ')}`);
  }
  if (freshness.gitDirty) {
    warnings.push('the working tree has uncommitted changes');
  }
  if (appConfig.activeWorkspace !== null && appConfig.activeWorkspace !== undefined) {
    warnings.push(
      `the app config is shared, not isolated: active workspace ${appConfig.activeWorkspace} is loaded for every sample`
    );
  }
  for (const [label, summary] of [
    ['cold', cold],
    ['warm', warm],
  ]) {
    if (summary !== null && summary.count < 20) {
      warnings.push(
        `${label} n=${summary.count} < 20, so the nearest-rank P95 is the maximum sample`
      );
    }
  }

  return warnings;
}

function printReport(result) {
  console.log('');
  console.log('startup measurement (WebView2, release binary)');
  console.log(`probe: ${result.probe}`);
  console.log(`p95: ${result.p95Method}`);
  if (result.cold !== null) {
    console.log(describe('cold', result.cold, budgets.coldP95));
  }
  if (result.warm !== null) {
    console.log(describe('warm', result.warm, budgets.warmP95));
  }
  console.log('');
  console.log(`git: ${result.freshness.gitHead ?? 'unknown'}`);
  console.log(
    `binary: ${result.freshness.binaryModifiedAt} sha256=${result.freshness.binarySha256}`
  );
  console.log(
    `config: ${result.appConfig.path} (${
      result.appConfig.exists ? `active ${result.appConfig.activeWorkspace ?? 'none'}` : 'missing'
    }, not isolated)`
  );
  for (const warning of result.warnings) {
    console.log(`warning: ${warning}`);
  }
  console.log('');
  if (result.cold !== null) {
    console.log('cold samples (ms):', result.coldSamples.join(', '));
  }
  if (result.warm !== null) {
    console.log('warm samples (ms):', result.warmSamples.join(', '));
  }
}

function describe(label, summary, budget) {
  return (
    `${label}: n=${summary.count} p50=${Math.round(summary.p50)}ms ` +
    `p95=${Math.round(summary.p95)}ms min=${Math.round(summary.min)}ms ` +
    `max=${Math.round(summary.max)}ms budget=${budget}ms ` +
    `${summary.p95 <= budget ? 'PASS' : 'OVER'}`
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
