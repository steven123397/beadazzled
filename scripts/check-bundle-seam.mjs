#!/usr/bin/env node
// The Playwright seam (`window.__BEADAZZLED_E2E__`) must never reach a release
// bundle. `main.tsx` gates the read behind `import.meta.env.DEV` and Vite drops
// the branch, but that guarantee lived only in a comment; this asserts it.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '__BEADAZZLED_E2E__';
const ASSET_DIRECTORY = 'dist/assets';
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  const root = parseRoot(process.argv.slice(2));
  const assetDirectory = path.join(root, ASSET_DIRECTORY);

  let bundles;
  try {
    bundles = readdirSync(assetDirectory).filter((name) => name.endsWith('.js'));
  } catch {
    throw new Error(`no ${ASSET_DIRECTORY}; run \`npm run build\` first`);
  }
  if (bundles.length === 0) {
    throw new Error(`no JavaScript bundle in ${ASSET_DIRECTORY}; run \`npm run build\` first`);
  }

  const leaking = bundles.filter((name) =>
    readFileSync(path.join(assetDirectory, name), 'utf8').includes(MARKER)
  );

  if (leaking.length > 0) {
    console.error(`check-bundle-seam: ${MARKER} leaked into ${leaking.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`check-bundle-seam: ${bundles.length} bundle(s) free of ${MARKER}`);
  }
} catch (error) {
  console.error(`check-bundle-seam: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}