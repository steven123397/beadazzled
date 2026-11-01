#!/usr/bin/env node
// Scans npm and Rust lockfiles with osv-scanner (CONSTRAINTS.md: 0 high-severity
// vulnerabilities). osv-scanner exits 1 whenever any advisory is found, so the
// severity decision is made here: high/critical block, and advisories with no
// severity data block too unless osv-allowlist.json waives them (ADR-0007).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateAllowlist,
  parseAllowlist,
  summarizeDependencyAudit,
} from './lib/dependency-audit.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const binaryName = process.platform === 'win32' ? 'osv-scanner.exe' : 'osv-scanner';

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
    if (!entry.isDirectory() || !entry.name.startsWith('Google.OSVScanner_')) {
      continue;
    }
    const candidate = path.join(packagesDirectory, entry.name, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveOsvScanner() {
  const configured = process.env.OSV_SCANNER_PATH;
  if (configured) {
    // CI injects this path explicitly; a typo must fail instead of silently
    // falling back to PATH/WinGet and running a different binary.
    if (!existsSync(configured)) {
      throw new Error(`OSV_SCANNER_PATH is set but does not exist: ${configured}`);
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

try {
  const scanner = resolveOsvScanner();
  if (!scanner) {
    console.error(
      'check-deps: osv-scanner not found. Install it (winget install Google.OSVScanner) ' +
        'or set OSV_SCANNER_PATH.'
    );
    process.exitCode = 1;
  } else {
    const root = parseRoot(process.argv.slice(2));
    const result = spawnSync(
      scanner,
      [
        'scan',
        'source',
        '--lockfile=package-lock.json',
        '--lockfile=src-tauri/Cargo.lock',
        '-f',
        'json',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES }
    );

    // 0 = clean, 1 = advisories found; anything else is a scanner failure.
    if (result.error || (result.status !== 0 && result.status !== 1)) {
      process.stderr.write(result.stderr ?? '');
      throw new Error(
        result.error
          ? `osv-scanner could not start: ${result.error.message}`
          : `osv-scanner exited with status ${result.status}`
      );
    }
    // Fail closed: findings without a JSON payload must not be read as clean.
    if (result.status === 1 && (result.stdout ?? '').trim() === '') {
      throw new Error('osv-scanner reported findings but produced no JSON');
    }

    const audit = summarizeDependencyAudit(JSON.parse(result.stdout || '{"results":[]}'));
    const { critical, high, medium, low, unknown } = audit.counts;
    console.log(
      `check-deps: ${critical} critical, ${high} high, ${medium} medium, ${low} low, ` +
        `${unknown} unknown`
    );

    const allowlistPath = path.join(root, 'osv-allowlist.json');
    const allowlistEntries = existsSync(allowlistPath)
      ? parseAllowlist(JSON.parse(readFileSync(allowlistPath, 'utf8')))
      : [];
    const waiver = evaluateAllowlist(audit.findings, allowlistEntries);

    for (const finding of waiver.waived) {
      console.log(`check-deps: waived ${finding.id} (${finding.package}) until ${finding.expires}`);
    }
    for (const finding of waiver.blocking) {
      console.error(
        `check-deps: ${finding.package}@${finding.version ?? '?'} ${finding.id} has unknown ` +
          'severity and is not in osv-allowlist.json'
      );
    }
    for (const entry of waiver.expired) {
      console.error(
        `check-deps: osv-allowlist.json entry ${entry.id} expired on ${entry.expires}; ` +
          'renew or remove it'
      );
    }
    for (const entry of waiver.unmatched) {
      console.log(
        `check-deps: osv-allowlist.json entry ${entry.id} matches no unknown advisory; ` +
          'remove it'
      );
    }

    if (audit.status === 'fail' || waiver.status === 'fail') {
      for (const finding of audit.findings) {
        if (finding.severity === 'critical' || finding.severity === 'high') {
          console.error(
            `check-deps: ${finding.package}@${finding.version ?? '?'} ${finding.id} ` +
              `(${finding.severity})`
          );
        }
      }
      console.error('check-deps: dependency audit failed');
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`check-deps: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
