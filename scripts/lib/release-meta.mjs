// Read the release version from the three places that must agree. Shared by
// check-versions (the editing-loop gate) and verify-release (the artifact
// check), so the two can never disagree about which sources count.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

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

export function readReleaseVersions(root) {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const tauri = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  return [
    ['package.json', packageJson.version],
    ['src-tauri/Cargo.toml', cargoVersion(root)],
    ['src-tauri/tauri.conf.json', tauri.version],
  ];
}

/** The updater public key from tauri.conf.json, or null when still a placeholder. */
export function readUpdaterPublicKey(root) {
  const tauri = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const key = tauri.plugins?.updater?.pubkey;
  if (typeof key !== 'string' || key.trim() === '' || key.includes('<')) {
    return null;
  }
  return key.trim();
}
