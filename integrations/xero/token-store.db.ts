import { CURRENT_KEY_VERSION, decryptToken, encryptToken } from "./crypto";
import { getPrisma, withTenant, withTenantLock, type ClientLike, type TxLike } from "./db";
import type { XeroTenantConnection, XeroTokenState, XeroTokenStore } from "./tokens";

/**
 * Database-backed token store — the production replacement for `FileXeroTokenStore`.
 *
 * The file store writes to `process.cwd()`, which on Vercel is an ephemeral container
 * filesystem: not shared between concurrent instances and gone on the next deploy. A
 * connection established there dies at the first cold start.
 *
 * `read`, `write` and `clear` are unchanged in signature. The tenant is injected at
 * construction rather than passed as an argument, so no call site changes — and when WorkOS
 * lands, the tenant comes from the session instead of an env var with nothing else moving.
 */

const PROVIDER = "XERO" as const;

export class DbXeroTokenStore implements XeroTokenStore {
  constructor(
    private readonly tenantId: string,
    private readonly client: ClientLike = getPrisma() as unknown as ClientLike,
  ) {
    if (!tenantId) {
      throw new Error("DbXeroTokenStore requires a tenant id (APP_TENANT_ID).");
    }
  }

  async read(): Promise<XeroTokenState | null> {
    return withTenant(this.client, this.tenantId, async (tx) => {
      const row = await tx.providerTokenGrant.findFirst({
        where: { tenantId: this.tenantId, provider: PROVIDER },
      });
      if (!row) return null;

      return {
        accessToken: decryptToken(row.accessTokenCipher, row.keyVersion),
        refreshToken: decryptToken(row.refreshTokenCipher, row.keyVersion),
        expiresAt: row.expiresAt.getTime(),
        scope: row.scope,
        connections: (row.connections ?? []) as readonly XeroTenantConnection[],
        activeTenantId: row.externalTenantId,
        connectedAt: row.connectedAt.toISOString(),
      };
    });
  }

  async write(state: XeroTokenState): Promise<void> {
    const access = encryptToken(state.accessToken);
    const refresh = encryptToken(state.refreshToken);

    await withTenant(this.client, this.tenantId, async (tx) => {
      await ensureTenant(tx, this.tenantId);

      const shared = {
        externalTenantId: state.activeTenantId,
        accessTokenCipher: access.cipher,
        refreshTokenCipher: refresh.cipher,
        keyVersion: CURRENT_KEY_VERSION,
        expiresAt: new Date(state.expiresAt),
        scope: state.scope,
        connections: state.connections,
        connectedAt: new Date(state.connectedAt),
      };

      await tx.providerTokenGrant.upsert({
        where: { tenantId_provider: { tenantId: this.tenantId, provider: PROVIDER } },
        create: { tenantId: this.tenantId, provider: PROVIDER, ...shared },
        update: shared,
      });
    });
  }

  async clear(): Promise<void> {
    await withTenant(this.client, this.tenantId, async (tx) => {
      await tx.providerTokenGrant.deleteMany({
        where: { tenantId: this.tenantId, provider: PROVIDER },
      });
    });
  }

  /**
   * Serialise token refreshes across processes.
   *
   * The in-process promise this replaces was correct on one Node process and meaningless on
   * serverless, where concurrent requests land in separate containers. The lock is held for
   * the whole read-refresh-write critical section, so a caller that loses the race waits and
   * then finds the already-refreshed token instead of spending a rotated one.
   */
  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    return withTenantLock(
      this.client,
      this.tenantId,
      refreshLockNamespace(this.tenantId),
      async () => fn(),
    );
  }
}

/** The lock namespace, exported so the integration test contends on the real key. */
export function refreshLockNamespace(tenantId: string): string {
  return `xero-refresh:${tenantId}`;
}

/**
 * `ProviderTokenGrant.tenantId` is a foreign key to `Tenant`, and RLS leaves no unscoped
 * write path, so the tenant row must exist before the first token is stored. Idempotent:
 * this runs on every write and does nothing once the row is there.
 */
async function ensureTenant(tx: TxLike, tenantId: string): Promise<void> {
  const existing = await tx.tenant.findUnique({ where: { id: tenantId } });
  if (existing) return;
  await tx.tenant.create({ data: { id: tenantId, name: tenantId } });
}
