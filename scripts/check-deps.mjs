#!/usr/bin/env node
// Scans npm and Rust lockfiles with osv-scanner (CONSTRAINTS.md: 0 high-severity
// vulnerabilities). osv-scanner exits 1 whenever any advisory is found, so the
// severity decision is made here: high/critical block, and advisories with no
// severity data block too unless osv-allowlist.json waives them (ADR-0007).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  evaluateAllowlist,
  parseAllowlist,
  summarizeDependencyAudit,
} from './lib/dependency-audit.mjs';
import { EXTERNAL_TOOLS, resolveTool } from './lib/find-binary.mjs';
import { parseRootArg, runCheck } from './lib/paths.mjs';

const MAX_BUFFER_BYTES = 128 * 1024 * 1024;

runCheck('check-deps', () => {
  const scanner = resolveTool(EXTERNAL_TOOLS.osvScanner);
  if (!scanner) {
    console.error(
      'check-deps: osv-scanner not found. Install it (winget install Google.OSVScanner) ' +
        'or set OSV_SCANNER_PATH.'
    );
    process.exitCode = 1;
  } else {
    const root = parseRootArg(process.argv.slice(2));
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
});
