import { parseCurrency, type CurrencyCode } from "../../core/money";
import type {
  AccountingConnector,
  NormalisationResult,
  NormalisedCommitment,
  NormalisedLedgerAccount,
} from "../types";
import {
  XeroNotConnectedError,
  fetchBankTransactions,
  fetchChartOfAccounts,
  fetchInvoices,
  fetchOrganisation,
  getConnectionState,
} from "./client";
import { XERO_SCOPES } from "./config";
import { normaliseAccounts, normaliseBankTransactions, normaliseInvoices } from "./normalise";
import type { NormalisedBankTransaction } from "./types";
import type { XeroTenantConnection } from "./tokens";

/**
 * The public face of the Xero adapter. Everything outside `integrations/xero/` imports from
 * here and receives only normalised, vendor-neutral shapes (invariant #6).
 */

export {
  XeroApiError,
  XeroNotConnectedError,
  XeroRateLimitError,
  clearChartOfAccountsCache,
  getConnectionState,
} from "./client";
export { XeroNotConfiguredError, isXeroConfigured } from "./config";
export type { XeroTenantConnection, XeroTokenState } from "./tokens";

/** Xero's UK Demo Company is GBP; used only when an org omits its base currency. */
const DEFAULT_BASE_CURRENCY: CurrencyCode = "GBP";

export function createXeroConnector(
  tenantId: string,
  baseCurrency: CurrencyCode,
): AccountingConnector {
  return {
    async fetchChartOfAccounts(): Promise<NormalisationResult<NormalisedLedgerAccount>> {
      const { accounts } = await fetchChartOfAccounts(tenantId);
      return normaliseAccounts(accounts);
    },
    async fetchCommitments(): Promise<NormalisationResult<NormalisedCommitment>> {
      const { invoices } = await fetchInvoices(tenantId);
      return normaliseInvoices(invoices, { fallbackCurrency: baseCurrency });
    },
  };
}

/**
 * What the connection screen should say, given a stored grant.
 *
 * The distinction that matters is between "several organisations, pick one" and "no
 * organisation at all". They both leave `activeTenantId` null, and treating them the same
 * renders a chooser with nothing to choose — a dead end with no explanation, which is exactly
 * what a real customer hits when they disconnect the app from inside Xero.
 */
export type ConnectionPrompt = "ready" | "choose-organisation" | "disconnected-in-xero";

export function connectionPrompt(state: {
  activeTenantId: string | null;
  connections: readonly unknown[];
}): ConnectionPrompt {
  if (state.activeTenantId) return "ready";
  return state.connections.length === 0 ? "disconnected-in-xero" : "choose-organisation";
}

export interface XeroOrganisationSummary {
  name: string;
  legalName: string | null;
  baseCurrency: CurrencyCode;
  countryCode: string | null;
  status: string | null;
}

/**
 * Scopes granted when the operator consented, compared against what the code now needs.
 *
 * Adding a scope does not upgrade an existing grant: Xero returns 401 `insufficient_scope`
 * at call time, which surfaces as an opaque API error nowhere near its cause. Detecting it
 * from the stored grant lets the screen ask for re-authorisation instead.
 */
export function missingScopes(grantedScope: string): string[] {
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return XERO_SCOPES.filter((scope) => !granted.has(scope));
}

export interface XeroSnapshot {
  tenantId: string;
  tenantName: string;
  connections: readonly XeroTenantConnection[];
  organisation: XeroOrganisationSummary | null;
  accounts: NormalisationResult<NormalisedLedgerAccount>;
  commitments: NormalisationResult<NormalisedCommitment>;
  /**
   * True when there are more outstanding invoices than the bounded read returned.
   *
   * The totals are then a FLOOR, not the figure. Presenting them unqualified would be a
   * confident number over an unknown subset — the thing non-negotiable #1 exists to prevent.
   */
  invoicesTruncated: boolean;
  bankTransactions: NormalisationResult<NormalisedBankTransaction>;
  /** Scopes the code needs that this grant does not have. Non-empty means re-consent. */
  missingScopes: string[];
  accountsFromCache: boolean;
}

/**
 * Everything the read-only Xero screen needs, in one call.
 *
 * Four API calls per uncached load (Organisation, Accounts, Invoices, BankTransactions)
 * against a 60/min, 5,000/day budget — hence the chart-of-accounts cache.
 */
export async function readXeroSnapshot(): Promise<XeroSnapshot> {
  const state = await getConnectionState();
  if (!state) throw new XeroNotConnectedError();
  if (!state.activeTenantId) {
    throw new XeroNotConnectedError();
  }
  const tenantId = state.activeTenantId;

  const organisation = await fetchOrganisation(tenantId);
  const baseCurrency = organisation?.BaseCurrency
    ? parseCurrency(organisation.BaseCurrency)
    : DEFAULT_BASE_CURRENCY;

  // A grant made before a scope was added cannot read the new endpoint. Skip the call
  // rather than spending it on a guaranteed 401 and reporting that as a Xero outage.
  const absent = missingScopes(state.scope);
  const needsBankScope = absent.includes("accounting.banktransactions.read");

  const [accountsPage, invoicesResult, bankTransactions] = await Promise.all([
    fetchChartOfAccounts(tenantId),
    fetchInvoices(tenantId),
    needsBankScope ? Promise.resolve([]) : fetchBankTransactions(tenantId),
  ]);

  const activeConnection = state.connections.find(
    (connection) => connection.tenantId === tenantId,
  );

  return {
    tenantId,
    tenantName: activeConnection?.tenantName ?? organisation?.Name ?? "(unknown organisation)",
    connections: state.connections,
    organisation: organisation
      ? {
          name: organisation.Name ?? "(unnamed)",
          legalName: organisation.LegalName ?? null,
          baseCurrency,
          countryCode: organisation.CountryCode ?? null,
          status: organisation.OrganisationStatus ?? null,
        }
      : null,
    accounts: normaliseAccounts(accountsPage.accounts),
    commitments: normaliseInvoices(invoicesResult.invoices, { fallbackCurrency: baseCurrency }),
    invoicesTruncated: invoicesResult.truncated,
    bankTransactions: normaliseBankTransactions(bankTransactions, {
      fallbackCurrency: baseCurrency,
    }),
    missingScopes: absent,
    accountsFromCache: accountsPage.cached,
  };
}
