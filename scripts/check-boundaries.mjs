#!/usr/bin/env node
// Enforces the architectural boundaries from spec/capability-map.md:
// - only src-tauri/src/bridge may spawn processes
// - the frontend must not spawn processes or reach the bd command layer
// - nothing may read the embedded Dolt store directly
// - reference code from AGPL/EPL/ELv2/CC-BY-NC projects must not enter the repo
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');

const SCANNED_DIRECTORIES = ['src', 'src-tauri/src', 'scripts'];
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'target',
  'gen',
  'coverage',
  '.git',
  '.beads',
  '.upstream',
]);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs']);

const BANNED_LICENSE =
  /\b(?:AGPL-3\.0|AGPLv3|EPL-2\.0|EPLv2|Elastic-2\.0|ELv2)\b|CC[- ]BY[- ]NC|GNU AFFERO GENERAL PUBLIC LICENSE|Eclipse Public License|Elastic License/i;
const FORBIDDEN_IMPORT =
  /(?:from\s*['"](?:next(?:\/[^'"]*)?|nuqs|(?:[^'"]*\/)?mock-data(?:\/[^'"]*)?)['"]|import\s*\(\s*['"](?:next(?:\/[^'"]*)?|nuqs|(?:[^'"]*\/)?mock-data(?:\/[^'"]*)?)['"]\s*\))/;
const CHILD_PROCESS_IMPORT =
  /(?:from\s*['"](?:node:)?child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]\s*\))/;

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isRustSource(relPath) {
  return relPath.startsWith('src-tauri/src/') && relPath.endsWith('.rs');
}

function isBridgeSource(relPath) {
  return relPath === 'src-tauri/src/bridge.rs' || relPath.startsWith('src-tauri/src/bridge/');
}

function isFrontendSource(relPath) {
  return relPath.startsWith('src/') && !relPath.endsWith('.d.ts');
}

const RULES = [
  {
    id: 'rust-process-spawn',
    applies: (relPath) => isRustSource(relPath) && !isBridgeSource(relPath),
    matches: (line) => /\b(?:std|tokio|async_std)::process::Command\b/.test(line),
    message: 'process spawning is only allowed in src-tauri/src/bridge',
  },
  {
    id: 'frontend-process-spawn',
    applies: (relPath) => isFrontendSource(relPath),
    matches: (line) => CHILD_PROCESS_IMPORT.test(line),
    message: 'the frontend must talk to Rust commands, not spawn child processes',
  },
  {
    id: 'forbidden-import',
    applies: (relPath) => isFrontendSource(relPath),
    matches: (line) => FORBIDDEN_IMPORT.test(line),
    message: 'next/*, nuqs and mock-data are reference-only and may not be imported',
  },
  {
    id: 'embedded-dolt-access',
    applies: () => true,
    matches: (line) => /embeddeddolt/i.test(line),
    message: 'ticket data is only read through bd commands, never the embedded Dolt store',
  },
  {
    id: 'banned-license',
    applies: () => true,
    matches: (line) => BANNED_LICENSE.test(line),
    message: 'code from AGPL/EPL/ELv2/CC-BY-NC projects may not be copied into this repo',
  },
];

function collectFiles(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = readdirSync(absoluteDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(absoluteDirectory, entry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...collectFiles(root, relativePath));
      }
      continue;
    }
    if (!entry.isFile() || !CODE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(absolutePath);
  }
  return files;
}

function scan(root) {
  const violations = [];
  let scannedFiles = 0;

  for (const directory of SCANNED_DIRECTORIES) {
    for (const absolutePath of collectFiles(root, directory)) {
      if (path.resolve(absolutePath) === path.resolve(scriptPath)) {
        continue;
      }
      const relPath = toPosix(path.relative(root, absolutePath));
      scannedFiles += 1;
      const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const rule of RULES) {
          if (rule.applies(relPath) && rule.matches(line)) {
            violations.push({
              location: `${relPath}:${index + 1}`,
              rule: rule.id,
              message: rule.message,
            });
          }
        }
      });
    }
  }

  return { violations, scannedFiles };
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
  const resolved = path.resolve(value);
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`--root is not a directory: ${resolved}`);
  }
  return resolved;
}

try {
  const root = parseRoot(process.argv.slice(2));
  const { violations, scannedFiles } = scan(root);

  if (violations.length === 0) {
    console.log(`check-boundaries: clean (${scannedFiles} files scanned)`);
  } else {
    for (const violation of violations) {
      console.log(`${violation.location}: ${violation.rule}: ${violation.message}`);
    }
    console.log(`check-boundaries: ${violations.length} violation(s) found`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`check-boundaries: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
