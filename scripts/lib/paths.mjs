import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const DEFAULT_RELEASE_EXE_REL = 'src-tauri/target/release/beadazzled.exe';

export function releaseExe(root = REPO_ROOT) {
  return path.join(root, DEFAULT_RELEASE_EXE_REL);
}

export function readJson(root, rel) {
  const filePath = rel ? path.join(root, rel) : root;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function projectRoot(importMetaUrl) {
  if (importMetaUrl) {
    const scriptPath = fileURLToPath(importMetaUrl);
    return path.resolve(path.dirname(scriptPath), '..');
  }
  return REPO_ROOT;
}

export function parseRootArg(argv, { requireDirectory = false, defaultRoot = REPO_ROOT } = {}) {
  const flagIndex = argv.indexOf('--root');
  if (flagIndex === -1) {
    return defaultRoot;
  }
  const value = argv[flagIndex + 1];
  if (!value) {
    throw new Error('--root requires a directory argument');
  }
  const resolved = path.resolve(value);
  if (requireDirectory && !statSync(resolved).isDirectory()) {
    throw new Error(`--root is not a directory: ${resolved}`);
  }
  return resolved;
}

export function runCheck(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.catch((error) => {
        console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
