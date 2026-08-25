import { describe, expect, it } from "vitest";
import { XERO_SCOPES } from "./config";

/**
 * Guards on the scope list. A wrong scope string is not caught by types, tests or the
 * build — it fails at Xero's authorize endpoint with `invalid_scope`, after a redirect,
 * which is a slow and confusing way to find out.
 */

const ACCOUNTING_SCOPES = XERO_SCOPES.filter((scope) => scope.startsWith("accounting."));

describe("XERO_SCOPES", () => {
  it("requests accounting.banktransactions.read for GET /BankTransactions", () => {
    // Verified against Xero's granular-scopes documentation, not inferred from the endpoint
    // name. A wrong string here fails at the authorize endpoint with invalid_scope, after a
    // redirect, with nothing in our own logs to explain it.
    expect(XERO_SCOPES).toContain("accounting.banktransactions.read");
  });

  it("does not use the deprecated broad accounting.transactions scope for bank data", () => {
    // accounting.banktransactions.read is the granular replacement. The broad scope is not
    // grantable to any app created on or after 2 March 2026, and ours is post-cutoff.
    for (const scope of XERO_SCOPES) {
      expect(scope).not.toBe("accounting.transactions");
      expect(scope).not.toBe("accounting.transactions.read");
    }
  });

  it("requests no write scope on any accounting resource", () => {
    // Invariant #2. A scope without the .read suffix grants write access.
    for (const scope of ACCOUNTING_SCOPES) {
      expect(scope).toMatch(/\.read$/);
    }
  });

  it("does not request the deprecated broad accounting.transactions scope", () => {
    // Not grantable to any app created on or after 2 March 2026: Xero rejects the entire
    // authorize request with invalid_scope. Replaced by accounting.invoices.read.
    // https://developer.xero.com/faq/granular-scopes
    for (const scope of XERO_SCOPES) {
      expect(scope).not.toMatch(/^accounting\.transactions/);
      expect(scope).not.toMatch(/^accounting\.reports\.read$/);
    }
  });

  it("covers every endpoint the adapter actually calls", () => {
    expect(XERO_SCOPES).toContain("accounting.settings.read"); // /Organisation, /Accounts
    expect(XERO_SCOPES).toContain("accounting.invoices.read"); // /Invoices
  });

  it("requests offline_access so the connection survives token expiry", () => {
    // Without it Xero issues no refresh token and the connection dies after 30 minutes.
    expect(XERO_SCOPES).toContain("offline_access");
  });

  it("contains no duplicates or stray whitespace", () => {
    expect(new Set(XERO_SCOPES).size).toBe(XERO_SCOPES.length);
    for (const scope of XERO_SCOPES) {
      expect(scope).toBe(scope.trim());
      expect(scope).not.toMatch(/\s/);
    }
  });
});
