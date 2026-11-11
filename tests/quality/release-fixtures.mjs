import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { withTempRoots } from './helpers.mjs';

export const keyPair = generateKeyPairSync('ed25519');
export const rawPublicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
export const keyId = randomBytes(8);
export const publicKeyBlob = Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString(
  'base64'
);

export function rawSignatureBlob(data) {
  const digest = createHash('blake2b512').update(data).digest();
  return Buffer.concat([Buffer.from('ED'), keyId, sign(null, digest, keyPair.privateKey)]).toString(
    'base64'
  );
}

export function signatureBlob(data, version = '0.1.0') {
  const signature = rawSignatureBlob(data);
  const trustedComment = `timestamp:1793757252\tfile:app.exe\tversion:${version}`;
  const globalSignature = sign(
    null,
    Buffer.concat([Buffer.from(signature, 'base64').subarray(10), Buffer.from(trustedComment)]),
    keyPair.privateKey
  ).toString('base64');
  const file = [
    'untrusted comment: signature from tauri secret key',
    signature,
    `trusted comment: ${trustedComment}`,
    globalSignature,
    '',
  ].join('\n');
  return Buffer.from(file, 'utf8').toString('base64');
}

export function writeRepo(root, options = {}) {
  const version = typeof options === 'string' ? options : (options.version ?? '0.1.0');
  const pubkey =
    typeof options === 'object' && options.publicKeyBlob ? options.publicKeyBlob : publicKeyBlob;
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    path.join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "beadazzled"\nversion = "${version}"\n`
  );
  writeFileSync(
    path.join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ version, plugins: { updater: { pubkey, requireSignedVersion: true } } })
  );
}

export function writeInstaller(dir, overrides = {}) {
  const version = overrides.version ?? '0.1.0';
  const installerName = overrides.installerName ?? `beadazzled_${version}_x64-setup.exe`;
  const bytes = overrides.bytes ?? Buffer.from('installer bytes');
  const signature =
    overrides.signature !== undefined
      ? overrides.signature
      : signatureBlob(bytes, overrides.signedVersion ?? version);
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
        'windows-x86_64': {
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
