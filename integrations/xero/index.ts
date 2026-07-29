import { parseCurrency, type CurrencyCode } from "../../core/money";
import type {
  AccountingConnector,
  NormalisationResult,
  NormalisedCommitment,
  NormalisedLedgerAccount,
} from "../types";
import {
  XeroNotConnectedError,
  fetchChartOfAccounts,
  fetchInvoices,
  fetchOrganisation,
  getConnectionState,
} from "./client";
import { normaliseAccounts, normaliseInvoices } from "./normalise";
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
      const invoices = await fetchInvoices(tenantId);
      return normaliseInvoices(invoices, { fallbackCurrency: baseCurrency });
    },
  };
}

export interface XeroOrganisationSummary {
  name: string;
  legalName: string | null;
  baseCurrency: CurrencyCode;
  countryCode: string | null;
  status: string | null;
}

export interface XeroSnapshot {
  tenantId: string;
  tenantName: string;
  connections: readonly XeroTenantConnection[];
  organisation: XeroOrganisationSummary | null;
  accounts: NormalisationResult<NormalisedLedgerAccount>;
  commitments: NormalisationResult<NormalisedCommitment>;
  accountsFromCache: boolean;
}

/**
 * Everything the read-only Xero screen needs, in one call.
 *
 * Three API calls per uncached load (Organisation, Accounts, Invoices) against a 60/min,
 * 5,000/day budget — hence the chart-of-accounts cache.
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

  const [accountsPage, invoices] = await Promise.all([
    fetchChartOfAccounts(tenantId),
    fetchInvoices(tenantId),
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
    commitments: normaliseInvoices(invoices, { fallbackCurrency: baseCurrency }),
    accountsFromCache: accountsPage.cached,
  };
}
