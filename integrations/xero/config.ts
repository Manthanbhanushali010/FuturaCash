import { z } from "zod";

/**
 * Xero constants and credentials. Credentials come from the environment and are read
 * lazily — the app must boot with Xero unconfigured (invariant #7: no secrets in code).
 */

export const XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
export const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
export const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/**
 * Read-only scopes only. Invariant #2: no code path moves money, so we never request a
 * write scope — Xero itself then enforces it, not just our discipline.
 */
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions.read",
  "accounting.contacts.read",
  "accounting.settings.read",
] as const;

/** Xero: 60 calls/min and 5,000/day per org. Chart of accounts barely changes — cache it. */
export const CHART_OF_ACCOUNTS_TTL_MS = 15 * 60 * 1000;

/** Refresh a little before true expiry so an in-flight request cannot land on a dead token. */
export const TOKEN_REFRESH_LEEWAY_MS = 60 * 1000;

const EnvSchema = z.object({
  XERO_CLIENT_ID: z.string().min(1, "XERO_CLIENT_ID is empty"),
  XERO_CLIENT_SECRET: z.string().min(1, "XERO_CLIENT_SECRET is empty"),
  XERO_REDIRECT_URI: z.string().url("XERO_REDIRECT_URI must be an absolute URL"),
});

export interface XeroConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class XeroNotConfiguredError extends Error {
  constructor(detail: string) {
    super(
      `Xero is not configured. ${detail}\n` +
        `Set XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI in .env.local ` +
        `(see .env.example), then restart the dev server.`,
    );
    this.name = "XeroNotConfiguredError";
  }
}

export function getXeroConfig(): XeroConfig {
  const parsed = EnvSchema.safeParse({
    XERO_CLIENT_ID: process.env.XERO_CLIENT_ID,
    XERO_CLIENT_SECRET: process.env.XERO_CLIENT_SECRET,
    XERO_REDIRECT_URI: process.env.XERO_REDIRECT_URI,
  });
  if (!parsed.success) {
    // Report which keys failed — never their values.
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new XeroNotConfiguredError(`Missing or invalid: ${keys}.`);
  }
  return {
    clientId: parsed.data.XERO_CLIENT_ID,
    clientSecret: parsed.data.XERO_CLIENT_SECRET,
    redirectUri: parsed.data.XERO_REDIRECT_URI,
  };
}

export function isXeroConfigured(): boolean {
  try {
    getXeroConfig();
    return true;
  } catch {
    return false;
  }
}
