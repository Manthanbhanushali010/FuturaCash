import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_KEY_VERSION,
  TokenEncryptionError,
  decryptToken,
  encryptToken,
  isTokenEncryptionConfigured,
  safeEqual,
} from "./crypto";

/**
 * These tokens are live credentials for a customer's accounting system. The properties that
 * matter are not "it round-trips" but "it refuses everything else": a wrong key, an altered
 * byte, a truncated row, or a key version we have no key for must all fail loudly rather
 * than return something that looks like a token.
 */

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

let original: string | undefined;

beforeEach(() => {
  original = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = original;
});

describe("token encryption", () => {
  it("round-trips a token", () => {
    const { cipher, keyVersion } = encryptToken("refresh-token-value");
    expect(keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(decryptToken(cipher, keyVersion)).toBe("refresh-token-value");
  });

  it("never stores the plaintext in the ciphertext", () => {
    const { cipher } = encryptToken("super-secret-refresh");
    expect(cipher.toString("utf8")).not.toContain("super-secret-refresh");
    expect(cipher.toString("base64")).not.toContain(
      Buffer.from("super-secret-refresh").toString("base64").slice(0, 12),
    );
  });

  it("produces a different ciphertext each time (fresh IV)", () => {
    const a = encryptToken("same-input").cipher.toString("hex");
    const b = encryptToken("same-input").cipher.toString("hex");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext", () => {
    const { cipher, keyVersion } = encryptToken("refresh-token-value");
    const tampered = Buffer.from(cipher);
    // Flip one bit in the body, past the IV and auth tag.
    const last = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(last) ^ 0x01, last);
    expect(() => decryptToken(tampered, keyVersion)).toThrow(TokenEncryptionError);
  });

  it("rejects a tampered auth tag", () => {
    const { cipher, keyVersion } = encryptToken("refresh-token-value");
    const tampered = Buffer.from(cipher);
    tampered.writeUInt8(tampered.readUInt8(12) ^ 0x01, 12); // first byte of the tag
    expect(() => decryptToken(tampered, keyVersion)).toThrow(TokenEncryptionError);
  });

  it("rejects the wrong key", () => {
    const { cipher, keyVersion } = encryptToken("refresh-token-value");
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptToken(cipher, keyVersion)).toThrow(TokenEncryptionError);
  });

  it("rejects a truncated row", () => {
    const { cipher, keyVersion } = encryptToken("refresh-token-value");
    expect(() => decryptToken(cipher.subarray(0, 10), keyVersion)).toThrow(TokenEncryptionError);
  });

  it("rejects a key version it has no key for", () => {
    const { cipher } = encryptToken("refresh-token-value");
    expect(() => decryptToken(cipher, CURRENT_KEY_VERSION + 1)).toThrow(TokenEncryptionError);
  });

  it("refuses to encrypt with no key configured", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(TokenEncryptionError);
    expect(isTokenEncryptionConfigured()).toBe(false);
  });

  it("refuses a key of the wrong length, without echoing it", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 9).toString("base64");
    expect(() => encryptToken("x")).toThrow(/32 bytes, got 16/);
    try {
      encryptToken("x");
    } catch (error) {
      expect((error as Error).message).not.toContain(process.env.TOKEN_ENCRYPTION_KEY);
    }
  });

  it("reports configuration status", () => {
    expect(isTokenEncryptionConfigured()).toBe(true);
  });

  it("handles unicode and long values", () => {
    const value = `${"x".repeat(4000)}·£€–✓`;
    const { cipher, keyVersion } = encryptToken(value);
    expect(decryptToken(cipher, keyVersion)).toBe(value);
  });
});

describe("safeEqual", () => {
  it("matches identical strings", () => {
    expect(safeEqual("hunter2", "hunter2")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(safeEqual("hunter2", "hunter3")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(safeEqual("short", "considerably-longer")).toBe(false);
  });
});
