import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  XeroRateLimitError,
  clearChartOfAccountsCache,
  fetchBankTransactions,
  fetchChartOfAccounts,
  fetchInvoices,
  getValidAccessToken,
} from "./client";
import { readXeroSnapshot } from "./index";
import { setXeroTokenStore, type XeroTokenState, type XeroTokenStore } from "./tokens";

/**
 * The read path against a stubbed Xero. Covers what unit tests cannot: that the right
 * headers go out, that the single-use refresh token is not raced away, and that a payload
 * shaped like Xero's arrives as correct normalised money.
 */

class MemoryStore implements XeroTokenStore {
  constructor(public state: XeroTokenState | null) {}
  writes = 0;
  async read() {
    return this.state;
  }
  async write(state: XeroTokenState) {
    this.state = state;
    this.writes += 1;
  }
  async clear() {
    this.state = null;
  }
  /** Mirrors FileXeroTokenStore: serialise, do not coalesce. */
  private tail: Promise<unknown> = Promise.resolve();
  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const TENANT = "tenant-abc";

function connectedState(overrides: Partial<XeroTokenState> = {}): XeroTokenState {
  return {
    accessToken: "access-live",
    refreshToken: "refresh-live",
    expiresAt: Date.now() + 30 * 60 * 1000,
    scope: "accounting.invoices.read",
    connections: [
      { connectionId: "c-1", tenantId: TENANT, tenantName: "Demo Company (UK)", tenantType: "ORGANISATION" },
    ],
    activeTenantId: TENANT,
    connectedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

const ORGANISATION_PAYLOAD = {
  Organisations: [
    {
      OrganisationID: "org-1",
      Name: "Demo Company (UK)",
      LegalName: "Demo Company (UK) Limited",
      BaseCurrency: "GBP",
      CountryCode: "GB",
      OrganisationStatus: "ACTIVE",
    },
  ],
};

const ACCOUNTS_PAYLOAD = {
  Accounts: [
    {
      AccountID: "acc-1",
      Code: "090",
      Name: "Business Bank Account",
      Type: "BANK",
      Class: "ASSET",
      Status: "ACTIVE",
      CurrencyCode: "GBP",
      BankAccountNumber: "12345678",
    },
    { AccountID: "acc-2", Code: "200", Name: "Sales", Type: "REVENUE", Class: "REVENUE", Status: "ACTIVE" },
  ],
};

const INVOICES_PAYLOAD = {
  Invoices: [
    {
      InvoiceID: "inv-1",
      InvoiceNumber: "INV-0001",
      Type: "ACCREC",
      Status: "AUTHORISED",
      Contact: { ContactID: "con-1", Name: "Borough Market Ltd" },
      DateString: "2026-07-01T00:00:00",
      DueDateString: "2026-08-16T00:00:00",
      CurrencyCode: "GBP",
      SubTotal: 1000,
      TotalTax: 200,
      Total: 1200,
      AmountDue: 1200,
      AmountPaid: 0,
    },
    {
      InvoiceID: "inv-2",
      InvoiceNumber: "BILL-0009",
      Type: "ACCPAY",
      Status: "AUTHORISED",
      Contact: { ContactID: "con-2", Name: "Matcha Supplier KK" },
      DateString: "2026-07-05T00:00:00",
      DueDateString: "2026-08-04T00:00:00",
      CurrencyCode: "GBP",
      Total: 8.16,
      AmountDue: 8.16,
      AmountPaid: 0,
    },
  ],
};

const BANK_TRANSACTIONS_PAYLOAD = {
  BankTransactions: [
    {
      BankTransactionID: "bt-0000-0001",
      Type: "RECEIVE",
      Status: "AUTHORISED",
      Reference: "Card takings",
      IsReconciled: true,
      Contact: { ContactID: "c-9", Name: "Square Payments" },
      BankAccount: { AccountID: "a-1", Code: "090", Name: "Business Current" },
      DateString: "2026-08-12T00:00:00",
      CurrencyCode: "GBP",
      SubTotal: 1240.5,
      TotalTax: 248.1,
      Total: 1488.6,
    },
  ],
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

let calls: Call[] = [];
let store: MemoryStore;

function stubFetch(handler: (url: string) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      const { status = 200, body, headers = {} } = handler(url);
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

function defaultHandler(url: string) {
  if (url.includes("/Organisation")) return { body: ORGANISATION_PAYLOAD };
  if (url.includes("/Accounts")) return { body: ACCOUNTS_PAYLOAD };
  if (url.includes("/Invoices")) return { body: INVOICES_PAYLOAD };
  if (url.includes("/BankTransactions")) return { body: BANK_TRANSACTIONS_PAYLOAD };
  if (url.includes("identity.xero.com/connect/token")) {
    return { body: { access_token: "access-rotated", refresh_token: "refresh-rotated", expires_in: 1800, token_type: "Bearer", scope: "x" } };
  }
  if (url.includes("api.xero.com/connections")) {
    return { body: [{ id: "c-1", tenantId: TENANT, tenantType: "ORGANISATION", tenantName: "Demo Company (UK)" }] };
  }
  throw new Error(`Unexpected URL in test: ${url}`);
}

beforeEach(() => {
  calls = [];
  store = new MemoryStore(connectedState());
  setXeroTokenStore(store);
  clearChartOfAccountsCache();
  vi.stubEnv("XERO_CLIENT_ID", "test-client");
  vi.stubEnv("XERO_CLIENT_SECRET", "test-secret");
  vi.stubEnv("XERO_REDIRECT_URI", "http://localhost:3000/api/xero/callback");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("authorised reads", () => {
  it("sends the tenant header and bearer token on every API call", () => {
    stubFetch(defaultHandler);
    return fetchChartOfAccounts(TENANT).then(() => {
      const apiCall = calls.find((call) => call.url.includes("/Accounts"));
      expect(apiCall).toBeDefined();
      // Without Xero-Tenant-Id the Accounting API does not know which org to read.
      expect(apiCall!.headers["Xero-Tenant-Id"]).toBe(TENANT);
      expect(apiCall!.headers.Authorization).toBe("Bearer access-live");
    });
  });

  it("serves the chart of accounts from cache on the second read", async () => {
    stubFetch(defaultHandler);
    const first = await fetchChartOfAccounts(TENANT);
    const second = await fetchChartOfAccounts(TENANT);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls.filter((call) => call.url.includes("/Accounts"))).toHaveLength(1);
  });

  it("excludes DRAFT invoices from the requested statuses", async () => {
    stubFetch(defaultHandler);
    await fetchInvoices(TENANT);
    const url = calls.find((call) => call.url.includes("/Invoices"))!.url;
    // A draft is not a commitment and must not show up as expected cash.
    expect(url).toContain("Statuses=AUTHORISED%2CSUBMITTED");
  });

  it("surfaces a 429 as a rate limit error rather than retrying", async () => {
    stubFetch(() => ({ status: 429, body: {}, headers: { "retry-after": "43", "x-rate-limit-problem": "minute" } }));

    await expect(fetchInvoices(TENANT)).rejects.toBeInstanceOf(XeroRateLimitError);
    expect(calls).toHaveLength(1);
  });

  it("builds a full snapshot with money as exact integer minor units", async () => {
    stubFetch(defaultHandler);
    const snapshot = await readXeroSnapshot();

    expect(snapshot.tenantId).toBe(TENANT);
    expect(snapshot.organisation?.baseCurrency).toBe("GBP");
    expect(snapshot.accounts.items).toHaveLength(2);
    expect(snapshot.accounts.failures).toEqual([]);
    expect(snapshot.commitments.failures).toEqual([]);

    const [receivable, payable] = snapshot.commitments.items;
    expect(receivable!.direction).toBe("INFLOW");
    expect(receivable!.total).toEqual({ minor: 120000, currency: "GBP" });
    expect(receivable!.dueAt).toBe("2026-08-16T00:00:00.000Z");

    expect(payable!.direction).toBe("OUTFLOW");
    expect(payable!.total).toEqual({ minor: 816, currency: "GBP" });
  });

  it("refuses a total carrying more precision than the currency has", async () => {
    // Xero totals are 2dp. A 3dp total means our assumption about the payload is wrong, so
    // the record is reported rather than rounded into something plausible.
    stubFetch((url) => {
      if (url.includes("/Invoices")) {
        return {
          body: {
            Invoices: [
              { ...INVOICES_PAYLOAD.Invoices[0], InvoiceID: "inv-odd", Total: 8.165, AmountDue: 8.165 },
            ],
          },
        };
      }
      return defaultHandler(url);
    });

    const snapshot = await readXeroSnapshot();
    expect(snapshot.commitments.items).toEqual([]);
    expect(snapshot.commitments.failures[0]!.externalId).toBe("inv-odd");
    expect(snapshot.commitments.failures[0]!.reason).toMatch(/more precision/);
  });

  it("reports a malformed invoice without losing the rest of the batch", async () => {
    stubFetch((url) => {
      if (url.includes("/Invoices")) {
        return {
          body: {
            Invoices: [
              ...INVOICES_PAYLOAD.Invoices,
              { InvoiceID: "inv-bad", Type: "MYSTERY", Status: "AUTHORISED", Total: 10 },
            ],
          },
        };
      }
      return defaultHandler(url);
    });

    const snapshot = await readXeroSnapshot();
    expect(snapshot.commitments.items).toHaveLength(2);
    expect(snapshot.commitments.failures).toHaveLength(1);
    expect(snapshot.commitments.failures[0]!.externalId).toBe("inv-bad");
  });
});

describe("token refresh", () => {
  it("refreshes an expired access token and persists the rotated refresh token", async () => {
    store.state = connectedState({ expiresAt: Date.now() - 1000 });
    stubFetch(defaultHandler);

    const state = await getValidAccessToken();

    expect(state.accessToken).toBe("access-rotated");
    expect(state.refreshToken).toBe("refresh-rotated");
    // Persisted before use — the old refresh token is now dead at Xero's end.
    expect(store.state!.refreshToken).toBe("refresh-rotated");
    expect(store.writes).toBe(1);
  });

  it("refreshes only once when several reads race an expired token", async () => {
    store.state = connectedState({ expiresAt: Date.now() - 1000 });
    stubFetch(defaultHandler);

    await Promise.all([getValidAccessToken(), getValidAccessToken(), getValidAccessToken()]);

    // Xero refresh tokens are single-use: a second concurrent refresh would present an
    // already-spent token, get invalid_grant, and kill the connection until re-authorisation.
    const refreshCalls = calls.filter((call) => call.url.includes("connect/token"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("does not refresh a token that is still comfortably valid", async () => {
    stubFetch(defaultHandler);
    await getValidAccessToken();
    expect(calls.filter((call) => call.url.includes("connect/token"))).toHaveLength(0);
  });
});

describe("fetchBankTransactions", () => {
  it("sends the tenant header and bearer token", async () => {
    stubFetch(defaultHandler);
    await fetchBankTransactions(TENANT);
    const call = calls.find((c) => c.url.includes("/BankTransactions"));
    expect(call).toBeDefined();
    expect(call?.headers["Xero-Tenant-Id"]).toBe(TENANT);
    expect(call?.headers["Authorization"]).toMatch(/^Bearer /);
  });

  it("filters to AUTHORISED with a where clause, not a Statuses parameter", async () => {
    // /BankTransactions has no Statuses shorthand — that is an /Invoices affordance.
    stubFetch(defaultHandler);
    await fetchBankTransactions(TENANT);
    const url = calls.find((c) => c.url.includes("/BankTransactions"))!.url;
    expect(decodeURIComponent(url)).toContain('Status=="AUTHORISED"');
    expect(url).not.toContain("Statuses=");
  });

  it("stops after a short page rather than paging forever", async () => {
    stubFetch(defaultHandler);
    await fetchBankTransactions(TENANT);
    // One row came back, which is fewer than Xero's page size, so there is nothing more.
    expect(calls.filter((c) => c.url.includes("/BankTransactions"))).toHaveLength(1);
  });

  it("pages while a full page comes back, bounded by maxPages", async () => {
    const full = { BankTransactions: Array.from({ length: 100 }, (_, i) => ({
      BankTransactionID: `bt-${i}`, Type: "SPEND", Status: "AUTHORISED", CurrencyCode: "GBP", Total: 1,
    })) };
    stubFetch((url) => (url.includes("/BankTransactions") ? { body: full } : defaultHandler(url)));

    const rows = await fetchBankTransactions(TENANT, { maxPages: 3 });
    const pages = calls.filter((c) => c.url.includes("/BankTransactions"));
    expect(pages).toHaveLength(3);
    expect(rows).toHaveLength(300);
    // The bound exists so one page load cannot burn the 5,000/day budget.
    expect(pages.map((c) => new URL(c.url).searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });

  it("rejects a payload that is not shaped like Xero's", async () => {
    stubFetch((url) =>
      url.includes("/BankTransactions") ? { body: { BankTransactions: [{ nope: true }] } } : defaultHandler(url),
    );
    await expect(fetchBankTransactions(TENANT)).rejects.toThrow(/unexpected payload/);
  });
});

describe("fetchInvoices ordering", () => {
  it("requests the MOST RECENT invoices, not the oldest", async () => {
    // Ascending order returned JENKI's oldest 200 -- due 2020-11 to 2021-09, all PAID -- so
    // the screen showed five-year-old history as the current position and both outstanding
    // totals rendered blank. A bounded read must start from the end that matters.
    stubFetch(defaultHandler);
    await fetchInvoices(TENANT);
    const url = calls.find((c) => c.url.includes("/Invoices"))!.url;
    // Parse the param: URLSearchParams encodes the space as "+", which decodeURIComponent
    // leaves alone, so a naive string match on "DueDate DESC" never matches.
    expect(new URL(url).searchParams.get("order")).toBe("DueDate DESC");
  });

  it("orders invoices the same way as bank transactions", async () => {
    // Both are bounded reads over an unbounded history; they must agree on which end to take.
    stubFetch(defaultHandler);
    await fetchInvoices(TENANT);
    await fetchBankTransactions(TENANT);
    const inv = new URL(calls.find((c) => c.url.includes("/Invoices"))!.url);
    const bank = new URL(calls.find((c) => c.url.includes("/BankTransactions"))!.url);
    expect(inv.searchParams.get("order")).toContain("DESC");
    expect(bank.searchParams.get("order")).toContain("DESC");
  });
});

describe("spec-1b — outstanding invoices, not a date window", () => {
  /** An invoice due in the past and still owed: the most cash-relevant kind, and the one
   *  a date-ordered window silently drops. */
  const OVERDUE = {
    InvoiceID: "inv-overdue",
    InvoiceNumber: "INV-OVERDUE",
    Type: "ACCREC",
    Status: "AUTHORISED",
    Contact: { ContactID: "c-od", Name: "Slow Payer Ltd" },
    DateString: "2026-06-01T00:00:00",
    DueDateString: "2026-07-01T00:00:00", // before "today" in these fixtures
    CurrencyCode: "GBP",
    Total: 500,
    AmountDue: 500,
    AmountPaid: 0,
  };

  it("does not request PAID invoices", async () => {
    // Including PAID spent the page bound on settled invoices, so the date window decided
    // which outstanding ones survived.
    stubFetch(defaultHandler);
    await fetchInvoices(TENANT);
    const url = calls.find((c) => c.url.includes("/Invoices"))!.url;
    const statuses = new URL(url).searchParams.get("Statuses");
    expect(statuses).toBe("AUTHORISED,SUBMITTED");
    expect(statuses).not.toContain("PAID");
  });

  it("still excludes DRAFT — a draft is not an obligation", async () => {
    stubFetch(defaultHandler);
    await fetchInvoices(TENANT);
    const statuses = new URL(calls.find((c) => c.url.includes("/Invoices"))!.url)
      .searchParams.get("Statuses");
    expect(statuses).not.toContain("DRAFT");
  });

  it("INCLUDES an overdue invoice", async () => {
    stubFetch((url) =>
      url.includes("/Invoices") ? { body: { Invoices: [OVERDUE] } } : defaultHandler(url));
    const { invoices } = await fetchInvoices(TENANT);
    expect(invoices.map((i) => i.InvoiceID)).toContain("inv-overdue");
  });

  it("carries an overdue invoice through to the outstanding totals", async () => {
    stubFetch((url) =>
      url.includes("/Invoices") ? { body: { Invoices: [OVERDUE] } } : defaultHandler(url));
    const snapshot = await readXeroSnapshot();
    const receivable = snapshot.commitments.items.find((c) => c.externalId === "inv-overdue");
    expect(receivable).toBeDefined();
    expect(receivable!.direction).toBe("INFLOW");
    // 500.00 -> integer minor units, and it must reach the position rather than be filtered.
    expect(receivable!.amountDue.minor).toBe(50000);
  });

  it("keeps an overdue invoice alongside a future-dated one", async () => {
    // Ordering must not be able to drop the overdue one when both fit in the page.
    const future = { ...OVERDUE, InvoiceID: "inv-future", DueDateString: "2027-03-01T00:00:00" };
    stubFetch((url) =>
      url.includes("/Invoices") ? { body: { Invoices: [future, OVERDUE] } } : defaultHandler(url));
    const { invoices } = await fetchInvoices(TENANT);
    expect(invoices.map((i) => i.InvoiceID).sort()).toEqual(["inv-future", "inv-overdue"]);
  });

  it("reports truncated when the bound is hit with a full page", async () => {
    const full = { Invoices: Array.from({ length: 100 }, (_, i) => ({ ...OVERDUE, InvoiceID: `i-${i}` })) };
    stubFetch((url) => (url.includes("/Invoices") ? { body: full } : defaultHandler(url)));
    const { invoices, truncated } = await fetchInvoices(TENANT, { maxPages: 2 });
    expect(invoices).toHaveLength(200);
    // Xero still had more and we stopped asking — the totals are a floor, not the figure.
    expect(truncated).toBe(true);
  });

  it("reports NOT truncated when the final page is short", async () => {
    let call = 0;
    stubFetch((url) => {
      if (!url.includes("/Invoices")) return defaultHandler(url);
      call += 1;
      return call === 1
        ? { body: { Invoices: Array.from({ length: 100 }, (_, i) => ({ ...OVERDUE, InvoiceID: `a-${i}` })) } }
        : { body: { Invoices: [{ ...OVERDUE, InvoiceID: "tail" }] } };
    });
    const { invoices, truncated } = await fetchInvoices(TENANT, { maxPages: 3 });
    expect(invoices).toHaveLength(101);
    expect(truncated).toBe(false);
  });

  it("reports NOT truncated for a single short page", async () => {
    stubFetch(defaultHandler);
    const { truncated } = await fetchInvoices(TENANT);
    expect(truncated).toBe(false);
  });

  it("carries the truncation flag onto the snapshot", async () => {
    const full = { Invoices: Array.from({ length: 100 }, (_, i) => ({ ...OVERDUE, InvoiceID: `s-${i}` })) };
    stubFetch((url) => (url.includes("/Invoices") ? { body: full } : defaultHandler(url)));
    const snapshot = await readXeroSnapshot();
    expect(snapshot.invoicesTruncated).toBe(true);
  });
});
