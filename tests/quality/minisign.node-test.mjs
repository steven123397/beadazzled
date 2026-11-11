import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { test } from 'node:test';

import { decodePublicKey, decodeSignature, verifyMinisign } from '../../scripts/lib/minisign.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const keyId = randomBytes(8);

function publicKeyBlob() {
  return Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]).toString('base64');
}

function signatureBlob(data, algorithm = 'ED') {
  const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  return Buffer.concat([Buffer.from(algorithm), keyId, sign(null, message, privateKey)]).toString(
    'base64'
  );
}

function armoredSignature(data, version = '0.1.0') {
  const signature = signatureBlob(data);
  const trustedComment = `timestamp:1793757252\tfile:app.exe\tversion:${version}`;
  const globalSignature = sign(
    null,
    Buffer.concat([Buffer.from(signature, 'base64').subarray(10), Buffer.from(trustedComment)]),
    privateKey
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

test('accepts a prehashed (ED) signature', () => {
  const data = Buffer.from('installer bytes');

  const result = verifyMinisign({
    publicKey: publicKeyBlob(),
    signature: signatureBlob(data),
    data,
  });

  assert.deepEqual(result, { ok: true });
});

test('accepts a direct (Ed) signature and armored public keys', () => {
  const data = Buffer.from('installer bytes');

  const result = verifyMinisign({
    publicKey: `untrusted comment: minisign public key\n${publicKeyBlob()}\n`,
    signature: signatureBlob(data, 'Ed'),
    data,
  });

  assert.deepEqual(result, { ok: true });
});

test('accepts the public key in the base64-of-file form Tauri stores', () => {
  const data = Buffer.from('installer bytes');
  const keyFile = `untrusted comment: minisign public key: 0102030405060708\n${publicKeyBlob()}\n`;
  const wrapped = Buffer.from(keyFile, 'utf8').toString('base64');

  const result = verifyMinisign({
    publicKey: wrapped,
    signature: signatureBlob(data),
    data,
  });

  assert.deepEqual(result, { ok: true });
});

test('accepts the signature file form Tauri writes', () => {
  const data = Buffer.from('installer bytes');
  const wrapped = armoredSignature(data);

  const result = verifyMinisign({
    publicKey: publicKeyBlob(),
    signature: wrapped,
    data,
    announcedVersion: '0.1.0',
    requireSignedVersion: true,
  });

  assert.deepEqual(result, { ok: true });
});

test('rejects a direct armored file instead of accepting a manifest-invalid shape', () => {
  const armored = Buffer.from(armoredSignature(Buffer.from('installer bytes')), 'base64').toString(
    'utf8'
  );

  assert.throws(() => decodeSignature(armored), /base64-wrapped|four-line/);
});

test('accepts updater-equivalent semver spellings', () => {
  const data = Buffer.from('installer bytes');
  const wrapped = armoredSignature(data, 'vv1.2.3+build.7');

  const result = verifyMinisign({
    publicKey: publicKeyBlob(),
    signature: wrapped,
    data,
    announcedVersion: '1.2.3+build.7',
    requireSignedVersion: true,
  });

  assert.deepEqual(result, { ok: true });
});

test('rejects a tampered trusted comment before reading its version', () => {
  const data = Buffer.from('installer bytes');
  const tamperedFile = Buffer.from(armoredSignature(data), 'base64')
    .toString('utf8')
    .replace('version:0.1.0', 'version:9.9.9');
  const wrapped = Buffer.from(tamperedFile, 'utf8').toString('base64');

  const result = verifyMinisign({
    publicKey: publicKeyBlob(),
    signature: wrapped,
    data,
    announcedVersion: '9.9.9',
    requireSignedVersion: true,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /global signature/);
});

test('rejects a missing signed version when required', () => {
  const data = Buffer.from('installer bytes');

  const result = verifyMinisign({
    publicKey: publicKeyBlob(),
    signature: signatureBlob(data),
    data,
    announcedVersion: '0.1.0',
    requireSignedVersion: true,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /trusted comment has no version/);
});

test('accepts the tauri-plugin-updater 2.14.1 official signed-version vector', () => {
  // Source: https://docs.rs/tauri-plugin-updater/2.14.1/src/tauri_plugin_updater/updater.rs.html#2117-2123
  const publicKey =
    'untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe';
  const signatureFile = `untrusted comment: signature from tauri secret key
RUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=
trusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0
DDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==`;

  const result = verifyMinisign({
    publicKey,
    signature: Buffer.from(signatureFile, 'utf8').toString('base64'),
    data: Buffer.from('test'),
    announcedVersion: '2.0.0',
    requireSignedVersion: true,
  });

  assert.deepEqual(result, { ok: true });
});

test('rejects tampered bytes', () => {
  const signature = signatureBlob(Buffer.from('installer bytes'));

  const result = verifyMinisign({
    publicKey: publicKeyBlob(),
    signature,
    data: Buffer.from('installer bytez'),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /does not match/);
});

test('rejects a signature made with another key', () => {
  const other = generateKeyPairSync('ed25519');
  const otherPublic = other.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const otherKeyId = randomBytes(8);
  const data = Buffer.from('installer bytes');
  const message = createHash('blake2b512').update(data).digest();
  const signature = Buffer.concat([
    Buffer.from('ED'),
    otherKeyId,
    sign(null, message, other.privateKey),
  ]).toString('base64');

  const result = verifyMinisign({ publicKey: publicKeyBlob(), signature, data });

  assert.equal(result.ok, false);
  assert.match(result.reason, /key id/);
});

test('rejects malformed blobs instead of guessing', () => {
  assert.throws(() => decodePublicKey('not-a-key'), /expected 42/);
  assert.throws(() => decodeSignature(Buffer.alloc(10).toString('base64')), /expected 74/);
});
