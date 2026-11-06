#!/usr/bin/env node
// Builds the latest.json manifest the updater endpoint serves.
//
// It only describes an artifact that already exists: the installer and the
// `.sig` produced by `tauri build` with TAURI_SIGNING_PRIVATE_KEY set. The
// script never signs or uploads anything, and it never touches the private key.
//
// Usage: node scripts/make-latest-json.mjs --installer <exe> [--version <v>]
//          [--url <download url>] [--notes <text>] [--root <repo>]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseOptions, runMain } from './lib/cli.mjs';
import { projectRoot } from './lib/paths.mjs';
import { UPDATER_PLATFORM, readReleaseVersions } from './lib/release-meta.mjs';

const defaultRoot = projectRoot(import.meta.url);
const PLATFORM = UPDATER_PLATFORM;

function usage() {
  return [
    'Usage: node scripts/make-latest-json.mjs --installer <exe> [options]',
    '',
    '  --installer <path>  signed installer (required; reads <installer>.sig)',
    '  --version <v>       version to publish (default: package.json)',
    '  --url <url>         download URL (default: GitHub release for the version)',
    '  --notes <text>      release notes for the manifest',
    '  --root <path>       repository root (default: this checkout)',
  ].join('\n');
}

function parseArgs(argv) {
  const options = parseOptions(argv, {
    values: ['--installer', '--version', '--url', '--notes', '--root'],
    usage,
    defaults: { installer: null, version: null, url: null, notes: '', root: defaultRoot },
    onValue(opts, name, value) {
      if (name === '--installer') opts.installer = path.resolve(value);
      if (name === '--version') opts.version = value;
      if (name === '--url') opts.url = value;
      if (name === '--notes') opts.notes = value;
      if (name === '--root') opts.root = path.resolve(value);
    },
  });
  if (options.installer === null) {
    throw new Error('--installer is required');
  }
  options.version ??= readReleaseVersions(options.root)[0][1];
  return options;
}

runMain('make-latest-json', () => {
  const options = parseArgs(process.argv.slice(2));
  const signaturePath = `${options.installer}.sig`;
  if (!existsSync(options.installer)) {
    throw new Error(`missing installer ${options.installer}`);
  }
  if (!existsSync(signaturePath)) {
    throw new Error(`missing signature ${signaturePath}; build with TAURI_SIGNING_PRIVATE_KEY set`);
  }

  const installerName = path.basename(options.installer);
  const signature = readFileSync(signaturePath, 'utf8').trim();
  const sha256 = createHash('sha256').update(readFileSync(options.installer)).digest('hex');
  const url =
    options.url ??
    `https://github.com/steven123397/beadazzled/releases/download/v${options.version}/${installerName}`;

  const manifest = {
    version: options.version,
    notes: options.notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [PLATFORM]: { signature, url, sha256 },
    },
  };
  const target = path.join(path.dirname(options.installer), 'latest.json');
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`make-latest-json: wrote ${target}`);
  console.log(`  version ${options.version} · ${installerName} · sha256 ${sha256.slice(0, 16)}…`);
});
