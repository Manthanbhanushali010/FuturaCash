import { promises as fs } from "node:fs";
import path from "node:path";

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
}

const DEV_STORE_FILENAME = ".xero-tokens.local.json";

/**
 * Local-development store: one JSON file in the project root, gitignored, owner-read-only.
 * Not for any deployed environment — there, tokens belong in the secret manager.
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
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

let defaultStore: XeroTokenStore | null = null;

export function getXeroTokenStore(): XeroTokenStore {
  defaultStore ??= new FileXeroTokenStore();
  return defaultStore;
}

/** Test seam — lets evals and tests substitute an in-memory store. */
export function setXeroTokenStore(store: XeroTokenStore): void {
  defaultStore = store;
}
