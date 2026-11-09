#!/usr/bin/env node
// Runs the deterministic .beads/config.yaml secret-key guard, then gitleaks
// with the command pinned in CONSTRAINTS.md. gitleaks is not always on PATH on
// Windows, so fall back to the WinGet package directory outside CI.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findSecretConfigKeys } from './lib/beads-config.mjs';
import { EXTERNAL_TOOLS, resolveTool } from './lib/find-binary.mjs';
import { parseRootArg, runCheck } from './lib/paths.mjs';

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

runCheck('check-secrets', () => {
  const root = parseRootArg(process.argv.slice(2));
  const configFailed = checkBeadsConfig(root);
  const gitleaks = resolveTool(EXTERNAL_TOOLS.gitleaks);
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
});
