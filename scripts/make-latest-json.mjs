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
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const PLATFORM = 'windows-x86_64';

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
  const options = { installer: null, version: null, url: null, notes: '', root: defaultRoot };
  const valueOptions = new Set(['--installer', '--version', '--url', '--notes', '--root']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const inline = separator === -1 ? undefined : arg.slice(separator + 1);
    if (name === '--help' || name === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (!valueOptions.has(name)) {
      throw new Error(`unknown option: ${arg}`);
    }
    const value = inline ?? argv[(index += 1)];
    if (value === undefined) {
      throw new Error(`${name} needs a value`);
    }
    if (name === '--installer') options.installer = path.resolve(value);
    if (name === '--version') options.version = value;
    if (name === '--url') options.url = value;
    if (name === '--notes') options.notes = value;
    if (name === '--root') options.root = path.resolve(value);
  }
  if (options.installer === null) {
    throw new Error('--installer is required');
  }
  options.version ??= JSON.parse(
    readFileSync(path.join(options.root, 'package.json'), 'utf8')
  ).version;
  return options;
}

try {
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
} catch (error) {
  console.error(`make-latest-json: ${error.message}`);
  process.exitCode = 1;
}
