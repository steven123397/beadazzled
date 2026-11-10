import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const EXTERNAL_TOOLS = {
  gitleaks: {
    binaryName: 'gitleaks',
    wingetPrefix: 'Gitleaks.Gitleaks_',
    envVar: 'GITLEAKS_PATH',
  },
  osvScanner: {
    binaryName: 'osv-scanner',
    wingetPrefix: 'Google.OSVScanner_',
    envVar: 'OSV_SCANNER_PATH',
  },
};

export function findOnPath(binary) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, binary);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function findInWinget(binary, wingetPrefix) {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA || !wingetPrefix) {
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
    if (!entry.isDirectory() || !entry.name.startsWith(wingetPrefix)) {
      continue;
    }
    const candidate = path.join(packagesDirectory, entry.name, binary);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveTool({ binaryName, wingetPrefix, envVar }) {
  const binary = process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
  if (envVar) {
    const configured = process.env[envVar];
    if (configured) {
      // CI injects this path explicitly; a typo must fail instead of silently
      // falling back to PATH/WinGet and running a different binary.
      if (!existsSync(configured)) {
        throw new Error(`${envVar} is set but does not exist: ${configured}`);
      }
      return configured;
    }
  }
  return findOnPath(binary) ?? findInWinget(binary, wingetPrefix);
}
