import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { UPDATER_PLATFORM } from '../../scripts/lib/release-meta.mjs';
import { withTempRoots } from './helpers.mjs';

export const keyPair = generateKeyPairSync('ed25519');
export const rawPublicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
export const keyId = randomBytes(8);
export const publicKeyBlob = Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64');

export function signatureBlob(data) {
  const digest = createHash('blake2b512').update(data).digest();
  return Buffer.concat([Buffer.from('ED'), keyId, sign(null, digest, keyPair.privateKey)]).toString(
    'base64'
  );
}

export function writeRepo(root, options = {}) {
  const version = typeof options === 'string' ? options : (options.version ?? '0.1.0');
  const pubkey = typeof options === 'object' && options.publicKeyBlob ? options.publicKeyBlob : publicKeyBlob;
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "beadazzled"\nversion = "${version}"\n`
  );
  writeFileSync(
    path.join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ version, plugins: { updater: { pubkey } } })
  );
}

export function writeInstaller(dir, overrides = {}) {
  const version = overrides.version ?? '0.1.0';
  const installerName = overrides.installerName ?? `beadazzled_${version}_x64-setup.exe`;
  const bytes = overrides.bytes ?? Buffer.from('installer bytes');
  const signature = overrides.signature !== undefined ? overrides.signature : signatureBlob(bytes);
  mkdirSync(dir, { recursive: true });
  const installer = path.join(dir, installerName);
  writeFileSync(installer, bytes);
  if (signature !== null) {
    writeFileSync(`${installer}.sig`, signature);
  }
  return { installer, bytes, signature, installerName };
}

export function writeFixture(root, overrides = {}) {
  const version = overrides.version ?? '0.1.0';
  const manifestVersion = overrides.manifestVersion ?? version;
  const dir = path.join(root, 'release');
  writeRepo(root, { version, publicKeyBlob });

  const { installer, bytes, signature, installerName } = writeInstaller(dir, {
    version,
    ...overrides,
  });

  writeFileSync(
    path.join(dir, 'latest.json'),
    JSON.stringify({
      version: manifestVersion,
      notes: 'Release notes',
      pub_date: '2026-11-04T00:00:00Z',
      platforms: {
        [UPDATER_PLATFORM]: {
          signature,
          url: `https://github.com/steven123397/beadazzled/releases/download/v${manifestVersion}/${installerName}`,
          ...(overrides.entrySha256 === undefined ? {} : { sha256: overrides.entrySha256 }),
        },
      },
    })
  );

  return { installer, dir, bytes, signature };
}

export function createTempRoots(prefix = 'beadazzled-') {
  return withTempRoots({ prefix });
}
