import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  gateDigest,
  isGateConfigured,
  isPasswordCorrect,
  isUnlocked,
  safeReturnPath,
} from "./page-gate";

const PASSWORD = "correct-horse-battery-staple";

let original: string | undefined;
beforeEach(() => {
  original = process.env.XERO_PAGE_PASSWORD;
  process.env.XERO_PAGE_PASSWORD = PASSWORD;
});
afterEach(() => {
  if (original === undefined) delete process.env.XERO_PAGE_PASSWORD;
  else process.env.XERO_PAGE_PASSWORD = original;
});

describe("gate digest", () => {
  it("is stable and 64 hex characters", async () => {
    const a = await gateDigest(PASSWORD);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await gateDigest(PASSWORD)).toBe(a);
  });

  it("never contains the password", async () => {
    expect(await gateDigest(PASSWORD)).not.toContain(PASSWORD);
  });

  it("differs for different passwords", async () => {
    expect(await gateDigest("a")).not.toBe(await gateDigest("b"));
  });

  it("is domain-separated from a bare SHA-256 of the password", async () => {
    const bare = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PASSWORD))),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(await gateDigest(PASSWORD)).not.toBe(bare);
  });
});

describe("constantTimeEqual", () => {
  it("matches identical strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
  });
  it("rejects same-length differences", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });
  it("rejects different lengths without throwing", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("isUnlocked", () => {
  it("accepts a cookie holding the correct digest", async () => {
    expect(await isUnlocked(await gateDigest(PASSWORD))).toBe(true);
  });

  it("rejects a missing cookie", async () => {
    expect(await isUnlocked(undefined)).toBe(false);
  });

  it("rejects the password itself as a cookie value", async () => {
    // The cookie stores a digest; presenting the raw secret must not work.
    expect(await isUnlocked(PASSWORD)).toBe(false);
  });

  it("rejects a digest of the wrong password", async () => {
    expect(await isUnlocked(await gateDigest("wrong"))).toBe(false);
  });

  it("FAILS CLOSED when no password is configured", async () => {
    const cookie = await gateDigest(PASSWORD);
    delete process.env.XERO_PAGE_PASSWORD;
    // Forgetting the variable in a deployment must lock the page, never open it.
    expect(await isUnlocked(cookie)).toBe(false);
    expect(await isUnlocked(undefined)).toBe(false);
    expect(isGateConfigured()).toBe(false);
  });
});

describe("isPasswordCorrect", () => {
  it("accepts the configured password", async () => {
    expect(await isPasswordCorrect(PASSWORD)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    expect(await isPasswordCorrect("nope")).toBe(false);
  });
  it("rejects an empty submission", async () => {
    expect(await isPasswordCorrect("")).toBe(false);
  });
  it("rejects a prefix of the real password", async () => {
    expect(await isPasswordCorrect(PASSWORD.slice(0, -1))).toBe(false);
  });
  it("fails closed when unconfigured", async () => {
    delete process.env.XERO_PAGE_PASSWORD;
    expect(await isPasswordCorrect("anything")).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it("keeps a same-origin path", () => {
    expect(safeReturnPath("/xero?tab=1")).toBe("/xero?tab=1");
  });
  it("defaults when absent", () => {
    expect(safeReturnPath(null)).toBe("/xero");
    expect(safeReturnPath("")).toBe("/xero");
  });
  it("refuses a protocol-relative URL (open redirect)", () => {
    expect(safeReturnPath("//evil.example.com")).toBe("/xero");
  });
  it("refuses an absolute URL", () => {
    expect(safeReturnPath("https://evil.example.com/steal")).toBe("/xero");
  });
});
