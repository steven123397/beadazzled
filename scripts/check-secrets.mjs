#!/usr/bin/env node
// Runs the deterministic .beads/config.yaml secret-key guard, then gitleaks
// with the command pinned in CONSTRAINTS.md. gitleaks is not always on PATH on
// Windows, so fall back to the WinGet package directory outside CI.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findSecretConfigKeys } from './lib/beads-config.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const binaryName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';

function findOnPath() {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function findInWinget() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
    return undefined;
  }
  const packagesDirectory = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  let entries;
  try {
    entries = readdirSync(packagesDirectory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('Gitleaks.Gitleaks_')) {
      continue;
    }
    const candidate = path.join(packagesDirectory, entry.name, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveGitleaks() {
  const configured = process.env.GITLEAKS_PATH;
  if (configured) {
    // CI injects this path explicitly; a typo must fail instead of silently
    // falling back to PATH/WinGet and running a different binary.
    if (!existsSync(configured)) {
      throw new Error(`GITLEAKS_PATH is set but does not exist: ${configured}`);
    }
    return configured;
  }
  return findOnPath() ?? findInWinget();
}

function parseRoot(argv) {
  const flagIndex = argv.indexOf('--root');
  if (flagIndex === -1) {
    return defaultRoot;
  }
  const value = argv[flagIndex + 1];
  if (!value) {
    throw new Error('--root requires a directory argument');
  }
  return path.resolve(value);
}

function checkBeadsConfig(root) {
  const configPath = path.join(root, '.beads', 'config.yaml');
  if (!existsSync(configPath)) {
    return false;
  }

  const findings = findSecretConfigKeys(readFileSync(configPath, 'utf8'));
  for (const key of findings) {
    console.error(
      `check-secrets: ${path.relative(root, configPath)} contains active secret key "${key}"`
    );
  }
  if (findings.length > 0) {
    console.error(
      'check-secrets: use GITHUB_TOKEN / LINEAR_API_KEY environment variables; ' +
        'never run `bd config set --force-git-tracked`'
    );
  }

  return findings.length > 0;
}

try {
  const root = parseRoot(process.argv.slice(2));
  const configFailed = checkBeadsConfig(root);
  const gitleaks = resolveGitleaks();
  if (!gitleaks) {
    console.error(
      'check-secrets: gitleaks not found. Install it (winget install Gitleaks.Gitleaks) ' +
        'or set GITLEAKS_PATH.'
    );
    process.exitCode = 1;
  } else {
    const result = spawnSync(gitleaks, ['detect', '--source', root, '--redact', '--no-banner'], {
      stdio: 'inherit',
    });
    process.exitCode = configFailed ? 1 : (result.status ?? 1);
  }
} catch (error) {
  console.error(`check-secrets: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
