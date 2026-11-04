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

test('accepts a prehashed (ED) signature', () => {
  const data = Buffer.from('installer bytes');

  const result = verifyMinisign({
    publicKey: publicKeyBlob(),
    signature: signatureBlob(data),
    data,
  });

  assert.deepEqual(result, { ok: true });
});

test('accepts a direct (Ed) signature and armored files', () => {
  const data = Buffer.from('installer bytes');

  const result = verifyMinisign({
    publicKey: `untrusted comment: minisign public key\n${publicKeyBlob()}\n`,
    signature: `untrusted comment: signature\n${signatureBlob(data, 'Ed')}\n`,
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
  const signatureFile = [
    'untrusted comment: signature from tauri secret key',
    signatureBlob(data),
    'trusted comment: timestamp:1793757252\tfile:app.exe\tversion:0.1.0',
    Buffer.alloc(64).toString('base64'),
    '',
  ].join('\n');
  const wrapped = Buffer.from(signatureFile, 'utf8').toString('base64');

  const result = verifyMinisign({ publicKey: publicKeyBlob(), signature: wrapped, data });

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
