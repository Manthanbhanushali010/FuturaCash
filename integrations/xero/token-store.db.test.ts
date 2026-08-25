import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { advisoryLockKey, type ClientLike, type ProviderTokenGrantRow, type TxLike } from "./db";
import { decryptToken, encryptToken } from "./crypto";
import { DbXeroTokenStore, refreshLockNamespace } from "./token-store.db";
import type { XeroTokenState } from "./tokens";

/**
 * Hermetic: the store takes its client as a constructor argument, so these run with no
 * database. The two things worth asserting are that tenant context is set inside the same
 * transaction as every query, and that no plaintext token reaches the client.
 */

const KEY = Buffer.alloc(32, 7).toString("base64");
const TENANT = "tenant-under-test";

interface Executed {
  sql: string;
  values: unknown[];
}

class FakeClient implements ClientLike {
  executed: Executed[] = [];
  grant: ProviderTokenGrantRow | null = null;
  tenants = new Set<string>();
  upserts: Record<string, unknown>[] = [];
  deletes = 0;
  transactions = 0;

  async $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number> {
    this.executed.push({ sql: query.join("?").replace(/\s+/g, " ").trim(), values });
    return 0;
  }

  async $transaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return fn(this);
  }

  providerTokenGrant = {
    findFirst: async (): Promise<ProviderTokenGrantRow | null> => this.grant,
    upsert: async (args: unknown): Promise<unknown> => {
      this.upserts.push(args as Record<string, unknown>);
      return args;
    },
    deleteMany: async (): Promise<{ count: number }> => {
      this.deletes += 1;
      this.grant = null;
      return { count: 1 };
    },
  };

  tenant = {
    findUnique: async (args: unknown): Promise<{ id: string } | null> => {
      const id = (args as { where: { id: string } }).where.id;
      return this.tenants.has(id) ? { id } : null;
    },
    create: async (args: unknown): Promise<unknown> => {
      this.tenants.add((args as { data: { id: string } }).data.id);
      return args;
    },
  };
}

function sampleState(overrides: Partial<XeroTokenState> = {}): XeroTokenState {
  return {
    accessToken: "access-plaintext",
    refreshToken: "refresh-plaintext",
    expiresAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    scope: "openid accounting.invoices.read",
    connections: [
      { connectionId: "c1", tenantId: "xero-org-1", tenantName: "Demo Company (UK)", tenantType: "ORGANISATION" },
    ],
    activeTenantId: "xero-org-1",
    connectedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let original: string | undefined;
beforeEach(() => {
  original = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  if (original === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = original;
});

describe("DbXeroTokenStore", () => {
  it("requires a tenant id", () => {
    expect(() => new DbXeroTokenStore("", new FakeClient())).toThrow(/tenant id/i);
  });

  it("returns null when no grant exists", async () => {
    const client = new FakeClient();
    expect(await new DbXeroTokenStore(TENANT, client).read()).toBeNull();
  });

  it("sets tenant context, transaction-scoped, before reading", async () => {
    const client = new FakeClient();
    await new DbXeroTokenStore(TENANT, client).read();

    expect(client.transactions).toBe(1);
    const setConfig = client.executed.find((e) => e.sql.includes("set_config"));
    expect(setConfig).toBeDefined();
    expect(setConfig?.sql).toContain("app.tenant_id");
    // `true` is the is_local flag: the setting dies with the transaction. Session-scoped
    // would leak one tenant's context into another's query through the pooler.
    expect(setConfig?.sql).toContain("true");
    expect(setConfig?.values).toContain(TENANT);
  });

  it("decrypts a stored grant back into token state", async () => {
    const client = new FakeClient();
    const access = encryptToken("access-plaintext");
    const refresh = encryptToken("refresh-plaintext");
    client.grant = {
      id: "g1",
      tenantId: TENANT,
      externalTenantId: "xero-org-1",
      accessTokenCipher: access.cipher,
      refreshTokenCipher: refresh.cipher,
      keyVersion: access.keyVersion,
      expiresAt: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)),
      scope: "openid accounting.invoices.read",
      connections: [{ connectionId: "c1", tenantId: "xero-org-1", tenantName: "Demo", tenantType: "ORGANISATION" }],
      connectedAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    const state = await new DbXeroTokenStore(TENANT, client).read();
    expect(state?.accessToken).toBe("access-plaintext");
    expect(state?.refreshToken).toBe("refresh-plaintext");
    expect(state?.expiresAt).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(state?.activeTenantId).toBe("xero-org-1");
    expect(state?.connectedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("writes ciphertext, never plaintext", async () => {
    const client = new FakeClient();
    await new DbXeroTokenStore(TENANT, client).write(sampleState());

    const upsert = client.upserts[0] as { create: Record<string, unknown> };
    const created = upsert.create;
    const accessCipher = created.accessTokenCipher as Buffer;
    const refreshCipher = created.refreshTokenCipher as Buffer;

    expect(accessCipher.toString("utf8")).not.toContain("access-plaintext");
    expect(refreshCipher.toString("utf8")).not.toContain("refresh-plaintext");
    // …and it is genuinely our ciphertext, not some other mangling.
    expect(decryptToken(accessCipher, created.keyVersion as number)).toBe("access-plaintext");
    expect(decryptToken(refreshCipher, created.keyVersion as number)).toBe("refresh-plaintext");
  });

  it("maps Xero's org id to externalTenantId, never to our tenantId", async () => {
    const client = new FakeClient();
    await new DbXeroTokenStore(TENANT, client).write(sampleState());

    const created = (client.upserts[0] as { create: Record<string, unknown> }).create;
    expect(created.externalTenantId).toBe("xero-org-1");
    expect(created.tenantId).toBe(TENANT);
  });

  it("creates the tenant row on first write, then not again", async () => {
    const client = new FakeClient();
    const store = new DbXeroTokenStore(TENANT, client);

    await store.write(sampleState());
    expect(client.tenants.has(TENANT)).toBe(true);

    // Second write must not attempt to re-create it — the FK is already satisfied.
    const before = client.tenants.size;
    await store.write(sampleState({ accessToken: "second" }));
    expect(client.tenants.size).toBe(before);
  });

  it("clears the grant within tenant context", async () => {
    const client = new FakeClient();
    await new DbXeroTokenStore(TENANT, client).clear();
    expect(client.deletes).toBe(1);
    expect(client.executed.some((e) => e.sql.includes("set_config"))).toBe(true);
  });

  it("takes a transaction-scoped advisory lock around a refresh", async () => {
    const client = new FakeClient();
    let ran = false;
    const result = await new DbXeroTokenStore(TENANT, client).withRefreshLock(async () => {
      ran = true;
      return "done";
    });

    expect(ran).toBe(true);
    expect(result).toBe("done");
    const lock = client.executed.find((e) => e.sql.includes("pg_advisory"));
    expect(lock).toBeDefined();
    // xact, not session: session-level locks do not survive transaction pooling.
    expect(lock?.sql).toContain("pg_advisory_xact_lock");
    expect(lock?.values).toContain(advisoryLockKey(refreshLockNamespace(TENANT)).toString());
  });

  it("sets tenant context before taking the lock", async () => {
    const client = new FakeClient();
    await new DbXeroTokenStore(TENANT, client).withRefreshLock(async () => null);

    const configIndex = client.executed.findIndex((e) => e.sql.includes("set_config"));
    const lockIndex = client.executed.findIndex((e) => e.sql.includes("pg_advisory"));
    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeGreaterThan(configIndex);
  });

  it("releases the lock by propagating failures rather than swallowing them", async () => {
    const client = new FakeClient();
    await expect(
      new DbXeroTokenStore(TENANT, client).withRefreshLock(async () => {
        throw new Error("refresh exploded");
      }),
    ).rejects.toThrow("refresh exploded");
  });
});

describe("advisoryLockKey", () => {
  it("is stable for the same namespace", () => {
    expect(advisoryLockKey("xero-refresh:a")).toBe(advisoryLockKey("xero-refresh:a"));
  });

  it("differs between tenants, so one tenant's refresh cannot block another's", () => {
    expect(advisoryLockKey(refreshLockNamespace("tenant-a"))).not.toBe(
      advisoryLockKey(refreshLockNamespace("tenant-b")),
    );
  });

  it("fits in a signed 64-bit integer", () => {
    const key = advisoryLockKey("anything");
    expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(key).toBeLessThan(2n ** 63n);
  });
});

/**
 * Regression guard for a bug the tests above structurally cannot catch.
 *
 * `ProviderTokenGrant` was added to schema.prisma and migrated, but `prisma generate` was
 * not re-run, so the generated client had no `providerTokenGrant` delegate. Every test in
 * this file passed — they inject a fake client — while the real store threw
 * "Cannot read properties of undefined (reading 'findFirst')" on first use.
 *
 * This asserts against the REAL generated client. It opens no connection.
 */
describe("generated Prisma client", () => {
  it("exposes every model DbXeroTokenStore depends on", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient() as unknown as Record<string, unknown>;
    for (const model of ["providerTokenGrant", "tenant"]) {
      expect(client[model], `missing delegate "${model}" — run \`prisma generate\``).toBeDefined();
    }
  });
});
