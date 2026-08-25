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
 *
 * GRANULAR SCOPES (Xero, 2 March 2026). The broad `accounting.transactions` scope and its
 * `.read` variant are deprecated and are simply not grantable to any app created on or
 * after that date — the authorize endpoint rejects the whole request with `invalid_scope`
 * before the consent screen renders. It is replaced by per-resource scopes; `/Invoices`
 * needs `accounting.invoices.read`. Apps created before the cutoff keep the broad scope
 * until September 2027, so a working example from an older codebase will mislead you here.
 * https://developer.xero.com/faq/granular-scopes
 *
 * Each scope below is here because a specific endpoint needs it — least privilege:
 *   accounting.settings.read  → GET /Organisation, GET /Accounts (chart of accounts)
 *   accounting.invoices.read  → GET /Invoices (sales invoices and bills)
 *   accounting.contacts.read  → the Contact on each invoice (counterparty names)
 *   accounting.banktransactions.read → GET /BankTransactions
 *
 * NOTE on bank transactions: these are Xero's record of money in and out of a bank account
 * as entered or reconciled in the LEDGER. They are not a bank feed. The live feed comes from
 * the Open Banking aggregator, and reconciliation is precisely the act of comparing the two —
 * so the two must never be conflated in the model.
 *
 * ADDING A SCOPE FORCES RE-CONSENT. An existing grant does not gain it; Xero returns 401
 * with `insufficient_scope` at call time. The connection screen detects this and asks the
 * operator to re-authorise rather than surfacing an opaque API error.
 */
export const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.settings.read",
  "accounting.invoices.read",
  "accounting.contacts.read",
  "accounting.banktransactions.read",
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
