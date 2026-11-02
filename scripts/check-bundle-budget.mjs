#!/usr/bin/env node
// Guards the first-screen JavaScript budget from CONSTRAINTS.md.
//
// Startup time follows what the WebView must download, parse and execute before
// the first commit. That is exactly `dist/index.html` plus everything it
// preloads: the entry chunk and any static imports Vite hoisted into it. Route
// chunks fetched later are deliberately not counted — this is the guard against
// a future screen being imported eagerly into the shell.
//
// Sizes are gzip -6 of each file, the same measure the budget is written in.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 150 * 1024;
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

/** Everything index.html makes the browser fetch before the app can render. */
function firstScreenUrls(html) {
  const urls = new Set();

  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    urls.add(match[1]);
  }
  for (const tag of html.match(/<link[^>]*>/g) ?? []) {
    if (!tag.includes('modulepreload')) {
      continue;
    }
    const href = /href="([^"]+)"/.exec(tag);
    if (href) {
      urls.add(href[1]);
    }
  }

  return [...urls];
}

function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

try {
  const root = parseRoot(process.argv.slice(2));
  const dist = path.join(root, 'dist');
  const indexHtml = path.join(dist, 'index.html');

  if (!existsSync(indexHtml)) {
    throw new Error('no dist/index.html; run `npm run build` first');
  }

  const urls = firstScreenUrls(readFileSync(indexHtml, 'utf8'));
  if (urls.length === 0) {
    throw new Error('dist/index.html loads no scripts; run `npm run build` first');
  }

  let total = 0;
  const files = [];
  for (const url of urls) {
    const relative = url.replace(/^\/+/, '');
    const absolute = path.resolve(dist, relative);
    if (!absolute.startsWith(dist + path.sep)) {
      throw new Error(`index.html references a file outside dist: ${url}`);
    }
    if (!existsSync(absolute)) {
      throw new Error(`index.html references a missing file: ${relative}`);
    }
    const gzip = gzipSync(readFileSync(absolute)).length;
    total += gzip;
    files.push({ relative, gzip });
  }

  for (const file of files) {
    console.log(`  ${file.relative}: ${formatKilobytes(file.gzip)} gzip`);
  }

  if (total > BUDGET_BYTES) {
    console.error(
      `check-bundle-budget: first screen is ${formatKilobytes(total)} gzip, ` +
        `over the ${formatKilobytes(BUDGET_BYTES)} budget. Move a screen behind ` +
        '`lazy()` or trim the entry dependencies.'
    );
    process.exitCode = 1;
  } else {
    console.log(
      `check-bundle-budget: first screen is ${formatKilobytes(total)} gzip ` +
        `(budget ${formatKilobytes(BUDGET_BYTES)})`
    );
  }
} catch (error) {
  console.error(`check-bundle-budget: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
