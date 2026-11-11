import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readJson } from './paths.mjs';

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
export const UPDATER_PLATFORM = 'windows-x86_64';

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
  return { versions, publicKey };
}

export function readReleaseVersions(root) {
  return readReleaseMeta(root).versions;
}
