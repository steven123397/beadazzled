import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readJson } from './paths.mjs';

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const UPDATER_PLATFORM = 'windows-x86_64';
export const RELEASE_URL_PREFIX = 'https://github.com/steven123397/beadazzled/releases/';

/** Accept only the canonical URL of this version's installer in our release. */
export function requireReleaseUrl(value, { version, installerName }) {
  if (!SEMVER.test(version)) {
    throw new Error(`release version must be semantic: ${version}`);
  }
  const expected = new URL(`${RELEASE_URL_PREFIX}download/v${version}/${installerName}`);
  let url;
  try {
    if (typeof value === 'string') {
      url = new URL(value);
    }
  } catch {
    // The validation error below is more actionable than a parser exception.
  }
  // Comparing canonical hrefs pins scheme, host, version directory and asset
  // name together; raw-prefix checks miss dot-segment repository escapes.
  if (url === undefined || url.href !== expected.href) {
    throw new Error(`release URL must use https and match ${expected.href}: ${value}`);
  }
  return url;
}

export function cargoVersion(root) {
  const text = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  let inPackage = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      inPackage = line.trim() === '[package]';
      continue;
    }
    if (!inPackage) {
      continue;
    }
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"/);
    if (match !== null) {
      return match[1];
    }
  }
  return null;
}

/** The updater public key from tauri.conf.json (or parsed config object), or null when placeholder. */
export function readUpdaterPublicKey(rootOrConfig) {
  const tauri =
    typeof rootOrConfig === 'object' && rootOrConfig !== null
      ? rootOrConfig
      : readJson(rootOrConfig, 'src-tauri/tauri.conf.json');
  const key = tauri.plugins?.updater?.pubkey;
  if (typeof key !== 'string' || key.trim() === '' || key.includes('<')) {
    return null;
  }
  return key.trim();
}

export function readReleaseMeta(root) {
  const packageJson = readJson(root, 'package.json');
  const tauri = readJson(root, 'src-tauri/tauri.conf.json');
  const versions = [
    ['package.json', packageJson.version],
    ['src-tauri/Cargo.toml', cargoVersion(root)],
    ['src-tauri/tauri.conf.json', tauri.version],
  ];
  const publicKey = readUpdaterPublicKey(tauri);
  const requireSignedVersion = tauri.plugins?.updater?.requireSignedVersion === true;
  return { versions, publicKey, requireSignedVersion };
}

export function readReleaseVersions(root) {
  return readReleaseMeta(root).versions;
}
