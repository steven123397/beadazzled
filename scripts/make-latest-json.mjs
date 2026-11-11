#!/usr/bin/env node
// Builds the latest.json manifest the updater endpoint serves.
//
// It only describes an artifact that already exists and verifies against the
// updater public key: the installer and the `.sig` produced by `tauri build`
// with TAURI_SIGNING_PRIVATE_KEY set. The script never signs or uploads anything,
// and it never touches the private key.
//
// Usage: node scripts/make-latest-json.mjs --installer <exe> [--version <v>]
//          [--url <download url>] [--notes <text> | --notes-file <path>] [--root <repo>]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseOptions, runMain } from './lib/cli.mjs';
import { verifyMinisign } from './lib/minisign.mjs';
import { projectRoot } from './lib/paths.mjs';
import {
  readReleaseMeta,
  readReleaseVersions,
  requireReleaseUrl,
  SEMVER,
  UPDATER_PLATFORM,
} from './lib/release-meta.mjs';

const defaultRoot = projectRoot(import.meta.url);
const PLATFORM = UPDATER_PLATFORM;

function usage() {
  return [
    'Usage: node scripts/make-latest-json.mjs --installer <exe> [options]',
    '',
    '  --installer <path>  signed installer (required; reads <installer>.sig)',
    '  --version <v>       version to publish (default: package.json)',
    '  --url <url>         must match the default canonical release asset URL',
    '  --notes <text>      release notes for the manifest',
    '  --notes-file <path> read UTF-8 release notes from a file',
    '  --root <path>       repository root (default: this checkout)',
  ].join('\n');
}

function parseArgs(argv) {
  const options = parseOptions(argv, {
    values: ['--installer', '--version', '--url', '--notes', '--notes-file', '--root'],
    allowEmpty: ['--notes'],
    usage,
    defaults: {
      installer: null,
      version: null,
      url: null,
      notes: null,
      notesFile: null,
      root: defaultRoot,
    },
    onValue(opts, name, value) {
      if (name === '--installer') opts.installer = path.resolve(value);
      if (name === '--version') opts.version = value;
      if (name === '--url') opts.url = value;
      if (name === '--notes') opts.notes = value;
      if (name === '--notes-file') opts.notesFile = path.resolve(value);
      if (name === '--root') opts.root = path.resolve(value);
    },
  });
  if (options.installer === null) {
    throw new Error('--installer is required');
  }
  if (options.notes !== null && options.notesFile !== null) {
    throw new Error('--notes and --notes-file are mutually exclusive');
  }
  options.version ??= readReleaseVersions(options.root)[0][1];
  return options;
}

runMain('make-latest-json', () => {
  const options = parseArgs(process.argv.slice(2));
  if (!SEMVER.test(options.version)) {
    throw new Error(`release version must be semantic: ${options.version}`);
  }
  const signaturePath = `${options.installer}.sig`;
  const notes =
    options.notesFile !== null ? readFileSync(options.notesFile, 'utf8') : (options.notes ?? '');

  // Error priority: a missing signature (forgot TAURI_SIGNING_PRIVATE_KEY) is
  // the more common, actionable failure, so report it before hashing.
  let signature;
  try {
    signature = readFileSync(signaturePath, 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `missing signature ${signaturePath}; build with TAURI_SIGNING_PRIVATE_KEY set`
      );
    }
    throw error;
  }

  let installerBytes;
  try {
    installerBytes = readFileSync(options.installer);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`missing installer ${options.installer}`);
    }
    throw error;
  }

  // Never publish a manifest for bytes the updater itself would reject.
  const { publicKey, requireSignedVersion } = readReleaseMeta(options.root);
  if (publicKey === null) {
    throw new Error('no updater public key: set plugins.updater.pubkey in tauri.conf.json');
  }
  const verification = verifyMinisign({
    publicKey,
    signature,
    data: installerBytes,
    announcedVersion: options.version,
    requireSignedVersion,
  });
  if (!verification.ok) {
    throw new Error(`signature verification failed: ${verification.reason}`);
  }
  const sha256 = createHash('sha256').update(installerBytes).digest('hex');

  const installerName = path.basename(options.installer);
  const url = requireReleaseUrl(
    options.url ??
      `https://github.com/steven123397/beadazzled/releases/download/v${options.version}/${installerName}`,
    { version: options.version, installerName }
  );

  const manifest = {
    version: options.version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      [PLATFORM]: { signature, url: url.href, sha256 },
    },
  };
  const target = path.join(path.dirname(options.installer), 'latest.json');
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`make-latest-json: wrote ${target}`);
  console.log(`  version ${options.version} · ${installerName} · sha256 ${sha256.slice(0, 16)}…`);
});
