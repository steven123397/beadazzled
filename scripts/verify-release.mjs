#!/usr/bin/env node
// Verifies the local release artifacts before anything is uploaded.
//
// The check is read-only: it never uploads, deletes or signs anything, and it
// never needs the private key. It fails on a signature that does not verify,
// a version that differs across package.json / Cargo.toml / tauri.conf.json /
// latest.json, a manifest URL that names another file, or a SHA-256 mismatch.
//
// Usage:
//   node scripts/verify-release.mjs --installer <exe> [--signature <sig>]
//     [--manifest <latest.json>] [--public-key <base64|path>] [--sha256 <hex>]
//     [--root <repo>] [--json]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeSignature, verifyMinisign } from './lib/minisign.mjs';
import { readReleaseVersions, readUpdaterPublicKey } from './lib/release-meta.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), '..');
const PLATFORM = 'windows-x86_64';

function usage() {
  return [
    'Usage: node scripts/verify-release.mjs --installer <exe> [options]',
    '',
    '  --installer <path>   installer to verify (required)',
    '  --signature <path>   minisign signature (default: <installer>.sig)',
    '  --manifest <path>    latest.json (default: next to the installer)',
    '  --public-key <value> base64 updater key or a file containing it',
    '                       (default: plugins.updater.pubkey in tauri.conf.json)',
    '  --sha256 <hex>       expected SHA-256 of the installer',
    '  --root <path>        repository root (default: this checkout)',
    '  --json               print the result as JSON',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    installer: null,
    signature: null,
    manifest: null,
    publicKey: null,
    sha256: null,
    root: defaultRoot,
    json: false,
  };
  const valueOptions = new Set([
    '--installer',
    '--signature',
    '--manifest',
    '--public-key',
    '--sha256',
    '--root',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const inline = separator === -1 ? undefined : arg.slice(separator + 1);
    if (name === '--json') {
      options.json = true;
      continue;
    }
    if (name === '--help' || name === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (!valueOptions.has(name)) {
      throw new Error(`unknown option: ${arg}`);
    }
    const value = inline ?? argv[(index += 1)];
    if (value === undefined || value === '') {
      throw new Error(`${name} needs a value`);
    }
    if (name === '--installer') options.installer = path.resolve(value);
    if (name === '--signature') options.signature = path.resolve(value);
    if (name === '--manifest') options.manifest = path.resolve(value);
    if (name === '--public-key') options.publicKey = value;
    if (name === '--sha256') options.sha256 = value.toLowerCase();
    if (name === '--root') options.root = path.resolve(value);
  }
  if (options.installer === null) {
    throw new Error('--installer is required');
  }
  options.signature ??= `${options.installer}.sig`;
  options.manifest ??= path.join(path.dirname(options.installer), 'latest.json');
  return options;
}

function readPublicKey(options) {
  if (options.publicKey !== null) {
    return existsSync(options.publicKey)
      ? readFileSync(options.publicKey, 'utf8')
      : options.publicKey;
  }
  const fromConfig = readUpdaterPublicKey(options.root);
  if (fromConfig === null) {
    throw new Error(
      'no updater public key: set plugins.updater.pubkey in tauri.conf.json or pass --public-key'
    );
  }
  return fromConfig;
}

function fail(errors) {
  for (const error of errors) {
    console.error(`verify-release: ${error}`);
  }
  process.exitCode = 1;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const errors = [];

  const missing = [options.installer, options.signature, options.manifest].filter(
    (file) => !existsSync(file)
  );
  if (missing.length > 0) {
    fail(missing.map((file) => `missing ${file}`));
  } else {
    const installerBytes = readFileSync(options.installer);
    const installerName = path.basename(options.installer);
    const signatureFile = readFileSync(options.signature, 'utf8').trim();
    const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
    const versions = readReleaseVersions(options.root);
    const manifestVersion = manifest.version;

    // Versions: the three sources and the manifest must agree.
    for (const [source, version] of versions) {
      if (version !== manifestVersion) {
        errors.push(`${source} is ${version}, latest.json is ${manifestVersion}`);
      }
    }
    if (!installerName.includes(manifestVersion)) {
      errors.push(`installer ${installerName} does not name version ${manifestVersion}`);
    }

    // Manifest: the platform entry must describe this exact file and signature.
    const entry = manifest.platforms?.[PLATFORM];
    if (entry === undefined) {
      errors.push(`latest.json has no platforms.${PLATFORM} entry`);
    } else {
      let urlName = '';
      try {
        urlName = decodeURIComponent(new URL(entry.url).pathname.split('/').pop() ?? '');
      } catch {
        errors.push(`latest.json url is not a URL: ${entry.url}`);
      }
      if (urlName !== installerName) {
        errors.push(`latest.json url names ${urlName || '(none)'}, not ${installerName}`);
      }
      if (typeof entry.signature !== 'string' || entry.signature.trim() !== signatureFile) {
        errors.push('latest.json signature does not match the .sig file');
      }
    }

    // Signature: verify the bytes with the embedded public key.
    let keyId = null;
    let signatureOk = false;
    try {
      const result = verifyMinisign({
        publicKey: readPublicKey(options),
        signature: signatureFile,
        data: installerBytes,
      });
      signatureOk = result.ok;
      if (!result.ok) {
        errors.push(result.reason);
      }
      keyId = decodeSignature(signatureFile).keyId.toString('hex');
    } catch (error) {
      errors.push(`signature check failed: ${error.message}`);
    }

    // Bytes: hash the installer and compare with whatever we were given.
    const sha256 = createHash('sha256').update(installerBytes).digest('hex');
    if (options.sha256 !== null && options.sha256 !== sha256) {
      errors.push(`SHA-256 is ${sha256}, expected ${options.sha256}`);
    }
    // make-latest-json records the hash per platform; older manifests may carry
    // it at the top level. Either one must match when present.
    for (const [where, recorded] of [
      ['latest.json', manifest.sha256],
      [`latest.json platforms.${PLATFORM}`, entry?.sha256],
    ]) {
      if (typeof recorded === 'string' && recorded.toLowerCase() !== sha256) {
        errors.push(`${where} sha256 does not match the installer`);
      }
    }

    const summary = {
      passed: errors.length === 0,
      version: manifestVersion,
      installer: installerName,
      bytes: statSync(options.installer).size,
      sha256,
      signature: { verified: signatureOk, keyId },
      url: entry?.url ?? null,
      errors,
    };

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      for (const error of errors) {
        console.error(`verify-release: ${error}`);
      }
    } else if (summary.passed) {
      console.log('verify-release: PASS');
      console.log(
        `  version    ${summary.version} (package.json, Cargo.toml, tauri.conf.json, latest.json)`
      );
      console.log(
        `  artifact   ${summary.installer} (${summary.bytes.toLocaleString('en-US')} bytes)`
      );
      console.log(`  sha256     ${summary.sha256}`);
      console.log(`  signature  OK (key id ${summary.signature.keyId})`);
      console.log(`  manifest   ${PLATFORM} -> ${summary.url}`);
    } else {
      fail(errors);
    }
    process.exitCode = summary.passed ? 0 : 1;
  }
} catch (error) {
  console.error(`verify-release: ${error.message}`);
  process.exitCode = 1;
}
