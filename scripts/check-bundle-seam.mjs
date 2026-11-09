#!/usr/bin/env node
// The Playwright seam (`window.__BEADAZZLED_E2E__`) must never reach a release
// bundle. `main.tsx` gates the read behind `import.meta.env.DEV` and Vite drops
// the branch, but that guarantee lived only in a comment; this asserts it.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseRootArg, runCheck } from './lib/paths.mjs';

const MARKER = '__BEADAZZLED_E2E__';
const ASSET_DIRECTORY = 'dist/assets';

runCheck('check-bundle-seam', () => {
  const root = parseRootArg(process.argv.slice(2));
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
});