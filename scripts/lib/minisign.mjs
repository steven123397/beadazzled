// Minisign verification for the release script.
//
// A Tauri updater signature is a minisign blob: a public key is base64 of
// "Ed" + 8-byte key id + 32-byte Ed25519 key, and a signature is base64 of
// "Ed"/"ED" + the same key id + a 64-byte Ed25519 signature. "ED" means the
// file was hashed with BLAKE2b-512 first (minisign -H); "Ed" signs the bytes
// directly. This module verifies both and never needs the private key.
import { createHash, createPublicKey, verify } from 'node:crypto';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PUBLIC_KEY_BYTES = 42;
const SIGNATURE_BYTES = 74;

/** Last non-comment line, i.e. the base64 payload of a minisign text file. */
function encodedLine(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('untrusted comment:'));
  return lines.at(-1) ?? '';
}

/** Accepts a bare base64 key/signature or a minisign text file with comments. */

export function decodePublicKey(text) {
  let raw = Buffer.from(encodedLine(text), 'base64');
  // Tauri's plugins.updater.pubkey stores the base64 of the minisign public
  // key *file* (comment line + key line), not the 42-byte key itself. Unwrap
  // that layer so both the .pub file and the bare key are accepted.
  if (raw.length !== PUBLIC_KEY_BYTES) {
    const inner = raw
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('RW'));
    if (inner !== undefined) {
      raw = Buffer.from(inner, 'base64');
    }
  }
  if (raw.length !== PUBLIC_KEY_BYTES) {
    throw new Error(`public key is ${raw.length} bytes, expected ${PUBLIC_KEY_BYTES}`);
  }
  const algorithm = raw.subarray(0, 2).toString('latin1');
  if (algorithm !== 'Ed') {
    throw new Error(`unsupported public key algorithm "${algorithm}"`);
  }
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10) };
}

export function decodeSignature(text) {
  let raw = Buffer.from(encodedLine(text), 'base64');
  // Tauri writes the .sig file as base64 of a minisign signature *file*
  // (untrusted comment, signature line, trusted comment, global signature).
  // Unwrap that layer, then verify the file signature it carries.
  if (raw.length !== SIGNATURE_BYTES) {
    const signatureLine = raw
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('RU'));
    if (signatureLine !== undefined) {
      raw = Buffer.from(signatureLine, 'base64');
    }
  }
  if (raw.length !== SIGNATURE_BYTES) {
    throw new Error(`signature is ${raw.length} bytes, expected ${SIGNATURE_BYTES}`);
  }
  const algorithm = raw.subarray(0, 2).toString('latin1');
  if (algorithm !== 'Ed' && algorithm !== 'ED') {
    throw new Error(`unsupported signature algorithm "${algorithm}"`);
  }
  return { algorithm, keyId: raw.subarray(2, 10), signature: raw.subarray(10) };
}

/**
 * Verifies `data` against a minisign public key and signature.
 * Returns `{ ok: true }` or `{ ok: false, reason }`; malformed input throws.
 */
export function verifyMinisign({ publicKey, signature, data }) {
  const key = decodePublicKey(publicKey);
  const sig = decodeSignature(signature);
  if (!sig.keyId.equals(key.keyId)) {
    return { ok: false, reason: 'signature key id does not match the public key' };
  }
  const message = sig.algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  const ed25519 = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, key.key]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, message, ed25519, sig.signature)
    ? { ok: true }
    : { ok: false, reason: 'signature does not match the artifact' };
}
