#!/usr/bin/env node
// Enforces the architectural boundaries from spec/capability-map.md:
// - only src-tauri/src/bridge may spawn processes
// - the frontend must not spawn processes or reach the bd command layer
// - no code may read the embedded Dolt store directly
// - reference code from AGPL/EPL/ELv2/CC-BY-NC projects must not enter the repo
//
// This is a text scan, not a compiler: string concatenation, macro expansion or
// wrapper crates (duct, xshell, ...) can still slip through. It catches the
// conventional forms so review only has to cover the unusual ones.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'target',
  'gen',
  'coverage',
  'playwright-report',
  'test-results',
  '.git',
  '.beads',
  '.upstream',
  '.agents',
  '.claude',
]);
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.rs',
]);

const BANNED_LICENSE =
  /\b(?:AGPL-3\.0|AGPLv3|EPL-2\.0|EPLv2|Elastic-2\.0|ELv2)\b|CC[- ]BY[- ]NC|GNU AFFERO GENERAL PUBLIC LICENSE|Eclipse Public License|Elastic License/i;
const REFERENCE_SPECIFIER = String.raw`(?:next(?:\/[^'"]*)?|nuqs|(?:[^'"]*\/)?mock-data(?:\/[^'"]*)?)`;
const FORBIDDEN_IMPORT = new RegExp(
  String.raw`(?:\bfrom\s*['"]${REFERENCE_SPECIFIER}['"]` +
    String.raw`|\brequire\s*\(\s*['"]${REFERENCE_SPECIFIER}['"]\s*\)` +
    String.raw`|\bimport\s*\(\s*['"]${REFERENCE_SPECIFIER}['"]\s*\)` +
    String.raw`|\bimport\s*['"]${REFERENCE_SPECIFIER}['"])`
);
const CHILD_PROCESS_IMPORT =
  /(?:\bfrom\s*['"](?:node:)?child_process['"]|\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)|\bimport\s*\(\s*['"](?:node:)?child_process['"]\s*\)|\bimport\s*['"](?:node:)?child_process['"])/;

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
  return relPath.startsWith('src/');
}

// `std :: process :: Command` is valid Rust; normalize before matching.
function normalizeRustLine(line) {
  return line.replace(/\s*::\s*/g, '::');
}

const RULES = [
  {
    id: 'rust-process-spawn',
    applies: (relPath) => isRustSource(relPath) && !isBridgeSource(relPath),
    matches: (line) => {
      const normalized = normalizeRustLine(line);
      return (
        /\bprocess::Command\b/.test(normalized) ||
        /\buse\s+(?:std|tokio|async_std)::process::\{[^}]*\bCommand\b/.test(normalized)
      );
    },
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

function collectFiles(root) {
  const files = [];
  const visit = (absoluteDirectory) => {
    let entries;
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  return files;
}

function scan(root) {
  const violations = [];
  let scannedFiles = 0;

  for (const absolutePath of collectFiles(root)) {
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
