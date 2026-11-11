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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { decodeSignature, verifyMinisign } from './lib/minisign.mjs';
import { UPDATER_PLATFORM, readReleaseMeta } from './lib/release-meta.mjs';
import { parseOptions, runMain } from './lib/cli.mjs';
import { projectRoot } from './lib/paths.mjs';

const defaultRoot = projectRoot(import.meta.url);
const PLATFORM = UPDATER_PLATFORM;

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
  const options = parseOptions(argv, {
    flags: ['--json'],
    values: ['--installer', '--signature', '--manifest', '--public-key', '--sha256', '--root'],
    usage,
    defaults: {
      installer: null,
      signature: null,
      manifest: null,
      publicKey: null,
      sha256: null,
      root: defaultRoot,
      json: false,
    },
    onFlag(opts, name) {
      if (name === '--json') opts.json = true;
    },
    onValue(opts, name, value) {
      if (name === '--installer') opts.installer = path.resolve(value);
      if (name === '--signature') opts.signature = path.resolve(value);
      if (name === '--manifest') opts.manifest = path.resolve(value);
      if (name === '--public-key') opts.publicKey = value;
      if (name === '--sha256') opts.sha256 = value.toLowerCase();
      if (name === '--root') opts.root = path.resolve(value);
    },
  });
  if (options.installer === null) {
    throw new Error('--installer is required');
  }
  options.signature ??= `${options.installer}.sig`;
  options.manifest ??= path.join(path.dirname(options.installer), 'latest.json');
  return options;
}

function readPublicKey(options, configKey) {
  if (options.publicKey !== null) {
    try {
      return readFileSync(options.publicKey, 'utf8');
    } catch (error) {
      // Only a missing file means the argument was a literal key. Anything
      // else (EISDIR, EPERM, ...) must surface instead of being verified as
      // the path string itself.
      if (error.code === 'ENOENT') {
        return options.publicKey;
      }
      throw error;
    }
  }
  if (configKey === null) {
    throw new Error(
      'no updater public key: set plugins.updater.pubkey in tauri.conf.json or pass --public-key'
    );
  }
  return configKey;
}

function fail(errors) {
  for (const error of errors) {
    console.error(`verify-release: ${error}`);
  }
  process.exitCode = 1;
}

function checkVersions(versions, manifestVersion, installerName, errors) {
  for (const [source, version] of versions) {
    if (version !== manifestVersion) {
      errors.push(`${source} is ${version}, latest.json is ${manifestVersion}`);
    }
  }
  if (!installerName.includes(manifestVersion)) {
    errors.push(`installer ${installerName} does not name version ${manifestVersion}`);
  }
}

function checkManifest(entry, installerName, signatureFile, errors) {
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
}

function checkSignature(options, configKey, signatureFile, installerBytes, errors) {
  let keyId = null;
  let signatureOk = false;
  try {
    const result = verifyMinisign({
      publicKey: readPublicKey(options, configKey),
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
  return { signatureOk, keyId };
}

function checkHash(installerBytes, optionsSha256, manifest, entry, errors) {
  const sha256 = createHash('sha256').update(installerBytes).digest('hex');
  if (optionsSha256 !== null && optionsSha256 !== sha256) {
    errors.push(`SHA-256 is ${sha256}, expected ${optionsSha256}`);
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
  return sha256;
}

function printJson(summary, errors) {
  console.log(JSON.stringify(summary, null, 2));
  for (const error of errors) {
    console.error(`verify-release: ${error}`);
  }
}

function printPassReport(summary) {
  console.log('verify-release: PASS');
  console.log(
    `  version    ${summary.version} (package.json, Cargo.toml, tauri.conf.json, latest.json)`
  );
  console.log(`  artifact   ${summary.installer} (${summary.bytes.toLocaleString('en-US')} bytes)`);
  console.log(`  sha256     ${summary.sha256}`);
  console.log(`  signature  OK (key id ${summary.signature.keyId})`);
  console.log(`  manifest   ${PLATFORM} -> ${summary.url}`);
}

runMain('verify-release', () => {
  const options = parseArgs(process.argv.slice(2));
  const errors = [];

  const missing = [options.installer, options.signature, options.manifest].filter(
    (file) => !existsSync(file)
  );
  if (missing.length > 0) {
    fail(missing.map((file) => `missing ${file}`));
    return;
  }

  const installerBytes = readFileSync(options.installer);
  const installerName = path.basename(options.installer);
  const signatureFile = readFileSync(options.signature, 'utf8').trim();
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  const { versions, publicKey: configKey } = readReleaseMeta(options.root);
  const manifestVersion = manifest.version;
  const entry = manifest.platforms?.[PLATFORM];

  checkVersions(versions, manifestVersion, installerName, errors);
  checkManifest(entry, installerName, signatureFile, errors);
  const { signatureOk, keyId } = checkSignature(
    options,
    configKey,
    signatureFile,
    installerBytes,
    errors
  );
  const sha256 = checkHash(installerBytes, options.sha256, manifest, entry, errors);

  const summary = {
    passed: errors.length === 0,
    version: manifestVersion,
    installer: installerName,
    bytes: installerBytes.length,
    sha256,
    signature: { verified: signatureOk, keyId },
    url: entry?.url ?? null,
    errors,
  };

  if (options.json) {
    printJson(summary, errors);
  } else if (summary.passed) {
    printPassReport(summary);
  } else {
    fail(errors);
  }
  process.exitCode = summary.passed ? 0 : 1;
});
