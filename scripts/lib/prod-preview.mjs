import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { projectRoot } from './paths.mjs';

const root = projectRoot();
const outDir = path.join(root, 'dist-e2e');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function resolvePort(raw, { envName = 'PORT', defaultPort = 1432 } = {}) {
  if (raw === undefined || raw === '') {
    return defaultPort;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${envName} must be an integer between 1024 and 65535`);
  }
  return value;
}

export function buildSeamBundle() {
  if (!existsSync(viteBin)) {
    throw new Error(`vite not found at ${viteBin}; run npm install first`);
  }
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

export async function servePreview({ port, envName = 'PORT' }) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(500) });
    throw new Error(`port ${port} is already serving; set ${envName} to a free port`);
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

export async function withPreview(options, fn) {
  let resolvedOptions = options;
  let runFn = fn;
  if (typeof options === 'function') {
    runFn = options;
    resolvedOptions = {};
  }
  const { port = 1432, envName = 'PORT' } = resolvedOptions ?? {};
  await rm(outDir, { recursive: true, force: true });
  buildSeamBundle();
  const server = await servePreview({ port, envName });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    return await runFn({ browser, port, server, outDir });
  } finally {
    await browser?.close();
    server?.kill();
    await rm(outDir, { recursive: true, force: true });
  }
}
