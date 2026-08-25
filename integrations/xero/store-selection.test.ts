import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which store gets selected, for every combination of the variables involved.
 *
 * This exists because a silent fallback to the file store cost real debugging time: on
 * Vercel it surfaces as EROFS deep inside the OAuth callback, nowhere near the missing
 * environment variable that caused it.
 */

const KEY32 = Buffer.alloc(32, 1).toString("base64");
const FULL = {
  DATABASE_URL: "postgresql://user:pw@host/db",
  APP_TENANT_ID: "futura-dev-tenant",
  TOKEN_ENCRYPTION_KEY: KEY32,
};

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  vi.resetModules();
});
afterEach(() => {
  process.env = saved;
});

async function selectWith(overrides: Record<string, string | undefined>): Promise<string> {
  for (const key of ["DATABASE_URL", "APP_TENANT_ID", "TOKEN_ENCRYPTION_KEY", "DIRECT_DATABASE_URL"]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...FULL, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const mod = await import("./tokens");
  return mod.describeXeroTokenStore();
}

describe("token store selection", () => {
  it("all three set -> database", async () => {
    expect(await selectWith({})).toBe("database");
  });

  it("DATABASE_URL missing -> file", async () => {
    expect(await selectWith({ DATABASE_URL: undefined })).toBe("file");
  });

  it("APP_TENANT_ID missing -> file", async () => {
    expect(await selectWith({ APP_TENANT_ID: undefined })).toBe("file");
  });

  it("TOKEN_ENCRYPTION_KEY missing -> file", async () => {
    expect(await selectWith({ TOKEN_ENCRYPTION_KEY: undefined })).toBe("file");
  });

  it("TOKEN_ENCRYPTION_KEY present but not 32 bytes -> file", async () => {
    // A truncated paste is the realistic version of this, and it fails identically.
    expect(await selectWith({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") })).toBe("file");
  });

  it("empty string counts as missing -> file", async () => {
    expect(await selectWith({ APP_TENANT_ID: "" })).toBe("file");
  });

  it("DIRECT_DATABASE_URL is NOT part of the decision -> still database", async () => {
    // It is used by Prisma Migrate, not the client. Absent at runtime is fine.
    expect(await selectWith({ DIRECT_DATABASE_URL: undefined })).toBe("database");
  });
});
