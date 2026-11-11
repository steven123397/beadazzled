// Minisign verification for the release script.
//
// A Tauri updater signature is a minisign blob: a public key is base64 of
// "Ed" + 8-byte key id + 32-byte Ed25519 key, and a signature is base64 of
// "Ed"/"ED" + the same key id + a 64-byte Ed25519 signature. "ED" means the
// file was hashed with BLAKE2b-512 first (minisign -H); "Ed" signs the bytes
// directly. This module verifies both and never needs the private key.
import { createHash, createPublicKey, verify } from 'node:crypto';

const NUMERIC_IDENTIFIER = String.raw`(?:0|[1-9]\d*)`;
const PRERELEASE_IDENTIFIER = String.raw`(?:${NUMERIC_IDENTIFIER}|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const UPDATER_SEMVER = new RegExp(
  String.raw`^${NUMERIC_IDENTIFIER}\.${NUMERIC_IDENTIFIER}\.${NUMERIC_IDENTIFIER}` +
    String.raw`(?:-${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*)?` +
    String.raw`(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`
);

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

function decodeBase64(text, label) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error(`${label} must be canonical base64`);
  }
  const raw = Buffer.from(text, 'base64');
  if (raw.toString('base64') !== text) {
    throw new Error(`${label} must be canonical base64`);
  }
  return raw;
}

function decodeArmoredSignature(text) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  if (lines.length !== 4) {
    throw new Error('signature must be a base64-wrapped four-line minisign file');
  }
  if (!lines[2].startsWith('trusted comment: ')) {
    throw new Error('signature trusted comment is missing or out of position');
  }
  return {
    raw: decodeBase64(lines[1], 'signature'),
    trustedComment: lines[2].slice(17),
    globalSignature: decodeBase64(lines[3], 'global signature'),
  };
}

export function decodeSignature(text) {
  // A .sig file may end with a newline; whitespace inside the payload or a
  // directly armored box is not a valid latest.json signature value.
  const boxed = String(text).trim();
  let decoded;
  try {
    decoded = decodeBase64(boxed, 'signature');
  } catch {
    throw new Error('signature must be bare base64 or a base64-wrapped four-line minisign file');
  }
  let parts;
  if (decoded.length < SIGNATURE_BYTES) {
    throw new Error(`signature is ${decoded.length} bytes, expected ${SIGNATURE_BYTES}`);
  }
  if (decoded.length === SIGNATURE_BYTES) {
    parts = { raw: decoded, trustedComment: null, globalSignature: null };
  } else {
    parts = decodeArmoredSignature(decoded.toString('utf8'));
  }
  const { raw, trustedComment, globalSignature } = parts;
  if (raw.length !== SIGNATURE_BYTES) {
    throw new Error(`signature is ${raw.length} bytes, expected ${SIGNATURE_BYTES}`);
  }
  if (globalSignature !== null && globalSignature.length !== 64) {
    throw new Error(`global signature is ${globalSignature.length} bytes, expected 64`);
  }
  const algorithm = raw.subarray(0, 2).toString('latin1');
  if (algorithm !== 'Ed' && algorithm !== 'ED') {
    throw new Error(`unsupported signature algorithm "${algorithm}"`);
  }
  return {
    algorithm,
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10),
    trustedComment,
    globalSignature,
  };
}

function withoutVersionPrefix(value) {
  return String(value).replace(/^v+/, '');
}

function signedVersionsMatch(signed, announced) {
  const signedSemver = withoutVersionPrefix(signed);
  const announcedSemver = withoutVersionPrefix(announced);
  return UPDATER_SEMVER.test(signedSemver) && UPDATER_SEMVER.test(announcedSemver)
    ? signedSemver === announcedSemver
    : signed === announced;
}

/**
 * Verifies `data` against a minisign public key and signature.
 * Returns `{ ok: true }` or `{ ok: false, reason }`; malformed input throws.
 * When an armored signature carries a trusted comment, its global signature is
 * verified before the version is read, matching tauri-plugin-updater 2.14.1:
 * https://docs.rs/tauri-plugin-updater/2.14.1/src/tauri_plugin_updater/updater.rs.html#1893-1967
 */
export function verifyMinisign({
  publicKey,
  signature,
  data,
  announcedVersion,
  requireSignedVersion = false,
}) {
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
  if (!verify(null, message, ed25519, sig.signature)) {
    return { ok: false, reason: 'signature does not match the artifact' };
  }

  if (sig.globalSignature !== null) {
    // minisign signs the raw 64-byte artifact signature followed by the trusted
    // comment without its "trusted comment: " prefix, with no additional hash.
    const globalMessage = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')]);
    if (!verify(null, globalMessage, ed25519, sig.globalSignature)) {
      return { ok: false, reason: 'global signature does not match the trusted comment' };
    }
  }

  const signedVersion = sig.trustedComment
    ?.split('\t')
    .find((field) => field.startsWith('version:'))
    ?.slice('version:'.length);
  if (signedVersion === undefined) {
    return requireSignedVersion
      ? { ok: false, reason: 'signature trusted comment has no version' }
      : { ok: true };
  }
  if (announcedVersion !== undefined && !signedVersionsMatch(signedVersion, announcedVersion)) {
    return {
      ok: false,
      reason: `signed version ${signedVersion} does not match manifest version ${announcedVersion}`,
    };
  }
  return { ok: true };
}
