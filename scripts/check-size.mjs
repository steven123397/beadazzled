#!/usr/bin/env node
// Checks the installer budget from CONSTRAINTS.md: every Windows bundle must stay
// at or below 15 MB. The installer is produced by `npm run build:app`.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const BUDGET_BYTES = 15 * 1024 * 1024;
const BUNDLE_DIRECTORIES = [
  'src-tauri/target/release/bundle/nsis',
  'src-tauri/target/release/bundle/msi',
];
const INSTALLER_EXTENSIONS = new Set(['.exe', '.msi']);

function collectInstallers(root) {
  const installers = [];
  for (const relativeDirectory of BUNDLE_DIRECTORIES) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !INSTALLER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      const absolutePath = path.join(absoluteDirectory, entry.name);
      installers.push({
        path: path.join(relativeDirectory, entry.name).split(path.sep).join('/'),
        bytes: statSync(absolutePath).size,
      });
    }
  }
  return installers;
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

function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

try {
  const root = parseRoot(process.argv.slice(2));
  const installers = collectInstallers(root);

  if (installers.length === 0) {
    console.error(
      'check-size: no installer found under src-tauri/target/release/bundle; ' +
        'run `npm run build:app` first.'
    );
    process.exitCode = 1;
  } else {
    let oversized = 0;
    for (const installer of installers) {
      console.log(`${installer.path}: ${formatMegabytes(installer.bytes)}`);
      if (installer.bytes > BUDGET_BYTES) {
        console.log(
          `${installer.path}: ${formatMegabytes(installer.bytes)} exceeds the ` +
            `${formatMegabytes(BUDGET_BYTES)} budget`
        );
        oversized += 1;
      }
    }
    if (oversized > 0) {
      process.exitCode = 1;
    } else {
      console.log(`check-size: all installers within the ${formatMegabytes(BUDGET_BYTES)} budget`);
    }
  }
} catch (error) {
  console.error(`check-size: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
