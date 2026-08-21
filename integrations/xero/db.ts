import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Database access for the Xero adapter.
 *
 * Two things here are load-bearing and easy to get subtly wrong:
 *
 * 1. TENANT CONTEXT IS TRANSACTION-SCOPED. The app reaches Neon through PgBouncer in
 *    transaction mode, where a connection is handed to a different client between
 *    statements. A session-level `SET` would either vanish before use or — far worse — leak
 *    one tenant's context into another tenant's query. `set_config(..., true)` is local to
 *    the transaction, so it dies with it.
 *
 * 2. THE ADVISORY LOCK IS TRANSACTION-SCOPED TOO. `pg_advisory_lock` is session-level and
 *    has exactly the same problem under transaction pooling; `pg_advisory_xact_lock` is
 *    released on commit or rollback, so a crashed process cannot strand the lock.
 *
 * The app must connect as a role WITHOUT the BYPASSRLS attribute, or every policy is
 * decorative. See context/progress-tracker.md.
 */

/** The subset of Prisma we use, so tests can inject a fake without a database. */
export interface TxLike {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  providerTokenGrant: {
    findFirst(args: unknown): Promise<ProviderTokenGrantRow | null>;
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  tenant: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
}

export interface ClientLike extends TxLike {
  $transaction<T>(
    fn: (tx: TxLike) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
}

export interface ProviderTokenGrantRow {
  id: string;
  tenantId: string;
  externalTenantId: string | null;
  accessTokenCipher: Uint8Array;
  refreshTokenCipher: Uint8Array;
  keyVersion: number;
  expiresAt: Date;
  scope: string;
  connections: unknown;
  connectedAt: Date;
}

const globalForPrisma = globalThis as unknown as { futuraPrisma?: PrismaClient };

/**
 * One client per process. Next.js hot-reload re-evaluates modules, and a fresh PrismaClient
 * per reload exhausts the connection pool within a few edits.
 */
export function getPrisma(): PrismaClient {
  globalForPrisma.futuraPrisma ??= new PrismaClient();
  return globalForPrisma.futuraPrisma;
}

/**
 * A transaction bound to one tenant. Every tenant-scoped read or write goes through here.
 *
 * The timeout is generous because the refresh path holds this open across an HTTP call to
 * Xero. That is a deliberate trade: a lease column would avoid it, but needs a schema change.
 */
export async function withTenant<T>(
  client: ClientLike,
  tenantId: string,
  fn: (tx: TxLike) => Promise<T>,
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/**
 * A stable 64-bit key for `pg_advisory_xact_lock`, derived in JS rather than via Postgres's
 * undocumented `hashtext`, so the value is reproducible and testable outside the database.
 */
export function advisoryLockKey(namespace: string): bigint {
  return createHash("sha256").update(namespace).digest().readBigInt64BE(0);
}

/**
 * Run `fn` while holding a cross-process lock for `namespace`, with tenant context set.
 *
 * Concurrent callers in other processes block here rather than proceeding in parallel —
 * which is the entire point. Xero rotates the refresh token on every refresh, so two
 * simultaneous refreshes leave one process holding a spent token; it survives on Xero's
 * 30-minute grace window and then dies, which is a miserable failure to diagnose.
 */
export async function withTenantLock<T>(
  client: ClientLike,
  tenantId: string,
  namespace: string,
  fn: (tx: TxLike) => Promise<T>,
): Promise<T> {
  const key = advisoryLockKey(namespace).toString();
  return withTenant(client, tenantId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}::bigint)`;
    return fn(tx);
  });
}
