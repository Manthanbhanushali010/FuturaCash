import { promises as fs } from "node:fs";
import path from "node:path";
import { isTokenEncryptionConfigured } from "./crypto";
import { DbXeroTokenStore } from "./token-store.db";

/**
 * Where Xero tokens live.
 *
 * The interface is the point. Spec 1 runs against a gitignored local file so the spike has
 * no infrastructure dependency; Spec 2 swaps in Postgres + a secret manager without any
 * call site changing. Tokens are credentials — invariant #7 — so they are never logged,
 * never rendered, and never committed.
 */

export interface XeroTenantConnection {
  /** Xero's own org identifier. Sent as the Xero-Tenant-Id header on every API call. */
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantType: string;
  /** Xero's id for the authorisation itself, not the org. */
  readonly connectionId: string;
}

export interface XeroTokenState {
  readonly accessToken: string;
  /** Single-use and rotated on every refresh — losing the new one bricks the connection. */
  readonly refreshToken: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  readonly scope: string;
  readonly connections: readonly XeroTenantConnection[];
  /** Which org reads are bound to. Never inferred silently when several are authorised. */
  readonly activeTenantId: string | null;
  readonly connectedAt: string;
}

export interface XeroTokenStore {
  read(): Promise<XeroTokenState | null>;
  write(state: XeroTokenState): Promise<void>;
  clear(): Promise<void>;
  /**
   * Run `fn` as the only token refresh for this connection at a time.
   *
   * Xero rotates the refresh token on every refresh and the old one dies after a 30-minute
   * grace window, so two concurrent refreshes leave one caller holding a spent token — a
   * failure that appears half an hour later, far from its cause. The store owns this because
   * only the store knows how far its serialisation actually reaches: one process for the
   * file store, every process for the database.
   *
   * Callers must re-read inside the callback: by the time the lock is granted, another
   * process may already have done the work.
   */
  withRefreshLock<T>(fn: () => Promise<T>): Promise<T>;
}

const DEV_STORE_FILENAME = ".xero-tokens.local.json";

/**
 * Local-development store: one JSON file in the project root, gitignored, owner-read-only.
 *
 * Not for any deployed environment. On Vercel `process.cwd()` is an ephemeral container
 * filesystem — not shared between concurrent instances, and gone at the next cold start or
 * deploy — so a connection made here would establish and then quietly disappear. Deployed
 * environments use `DbXeroTokenStore`.
 */
export class FileXeroTokenStore implements XeroTokenStore {
  private readonly filePath: string;

  constructor(filePath = path.join(process.cwd(), DEV_STORE_FILENAME)) {
    this.filePath = filePath;
  }

  async read(): Promise<XeroTokenState | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as XeroTokenState;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async write(state: XeroTokenState): Promise<void> {
    // 0o600 — the file holds live credentials for a real accounting org.
    await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  /** Serialised in-process. Sufficient here: one process, one file, one machine. */
  private tail: Promise<unknown> = Promise.resolve();

  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    // Swallow only for the queue's own chaining — the caller still sees the rejection.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

let defaultStore: XeroTokenStore | null = null;

/**
 * Database when it is fully configured, file otherwise.
 *
 * All three variables are required together on purpose. A half-configured database store
 * would either fail at the first write or, worse, persist tokens it cannot encrypt — so an
 * incomplete configuration falls back to the local file rather than degrading silently.
 */
function createDefaultStore(): XeroTokenStore {
  const tenantId = process.env.APP_TENANT_ID;
  if (process.env.DATABASE_URL && tenantId && isTokenEncryptionConfigured()) {
    return new DbXeroTokenStore(tenantId);
  }
  return new FileXeroTokenStore();
}

export function getXeroTokenStore(): XeroTokenStore {
  defaultStore ??= createDefaultStore();
  return defaultStore;
}

/** Which store is active. Surfaced for diagnostics — never returns credentials. */
export function describeXeroTokenStore(): "database" | "file" {
  return getXeroTokenStore() instanceof DbXeroTokenStore ? "database" : "file";
}

/** Test seam — lets evals and tests substitute an in-memory store. */
export function setXeroTokenStore(store: XeroTokenStore): void {
  defaultStore = store;
}
