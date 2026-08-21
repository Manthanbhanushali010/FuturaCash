import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope encryption for OAuth tokens at rest.
 *
 * Neon encrypts its disks, but that protects the disk — not anyone holding a connection
 * string. A refresh token is a live credential for a customer's accounting system, so it is
 * encrypted by the application before it reaches the database and decrypted after it leaves.
 * The database never holds a usable token (invariant #7).
 *
 * AES-256-GCM is authenticated: a tampered ciphertext fails to decrypt rather than yielding
 * plausible garbage. Stored layout is `iv ‖ authTag ‖ ciphertext`, all in one BYTEA.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Bumped when the key changes. Persisted per row so old rows stay readable mid-rotation. */
export const CURRENT_KEY_VERSION = 1;

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenEncryptionError";
  }
}

function loadKey(version: number): Buffer {
  if (version !== CURRENT_KEY_VERSION) {
    throw new TokenEncryptionError(
      `No key configured for keyVersion ${version}. Retain the previous key during rotation.`,
    );
  }
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new TokenEncryptionError(
      "TOKEN_ENCRYPTION_KEY is not set. Generate 32 random bytes, base64-encoded.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    // Never echo the value — only its shape.
    throw new TokenEncryptionError(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

/** True when a usable key is configured. Used to decide whether the DB store can run. */
export function isTokenEncryptionConfigured(): boolean {
  try {
    loadKey(CURRENT_KEY_VERSION);
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plaintext: string): { cipher: Buffer; keyVersion: number } {
  const key = loadKey(CURRENT_KEY_VERSION);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    cipher: Buffer.concat([iv, cipher.getAuthTag(), body]),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptToken(stored: Uint8Array, keyVersion: number): string {
  const buffer = Buffer.from(stored);
  if (buffer.length < IV_BYTES + TAG_BYTES) {
    throw new TokenEncryptionError("Ciphertext is too short to contain an IV and auth tag.");
  }
  const key = loadKey(keyVersion);
  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = buffer.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed: wrong key, or the stored bytes were altered. Both are
    // "do not trust this row", and neither should leak which one it was.
    throw new TokenEncryptionError(
      "Token failed authenticated decryption — wrong key or tampered ciphertext.",
    );
  }
}

/** Constant-time compare for the shared-secret gate in a later phase. Kept beside its peers. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
