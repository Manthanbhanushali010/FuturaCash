import { z } from "zod";
import {
  CHART_OF_ACCOUNTS_TTL_MS,
  TOKEN_REFRESH_LEEWAY_MS,
  XERO_API_BASE,
  XERO_AUTHORIZE_URL,
  XERO_CONNECTIONS_URL,
  XERO_SCOPES,
  XERO_TOKEN_URL,
  getXeroConfig,
} from "./config";
import {
  AccountsResponse,
  BankTransactionsResponse,
  BatchPaymentsResponse,
  ConnectionsResponse,
  OverpaymentsResponse,
  PaymentsResponse,
  PrepaymentsResponse,
  InvoicesResponse,
  OrganisationsResponse,
  TokenErrorResponse,
  TokenResponse,
  type XeroAccount,
  type XeroBankTransaction,
  type XeroBatchPayment,
  type XeroInvoice,
  type XeroPayment,
  type XeroUnallocatedCredit,
  type XeroOrganisation,
  CreditNotesResponse,
  XeroCreditNote,
} from "./schemas";
import {
  getXeroTokenStore,
  type XeroTenantConnection,
  type XeroTokenState,
} from "./tokens";

/**
 * The only place that speaks HTTP to Xero. Plain fetch, no vendor SDK — the surface we need
 * is four endpoints, and an SDK's model types would leak past the anti-corruption boundary.
 */

export class XeroApiError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    readonly detail: string,
  ) {
    super(`Xero ${endpoint} failed with ${status}: ${detail}`);
    this.name = "XeroApiError";
  }
}

/** Xero allows 60 calls/min and 5,000/day per org. Backing off is the caller's decision. */
export class XeroRateLimitError extends XeroApiError {
  constructor(
    endpoint: string,
    readonly retryAfterSeconds: number | null,
    readonly limitType: string | null,
  ) {
    super(429, endpoint, `rate limit reached (${limitType ?? "unknown limit"})`);
    this.name = "XeroRateLimitError";
  }
}

export class XeroNotConnectedError extends Error {
  constructor() {
    super("No Xero connection. Visit /api/xero/connect to authorise an organisation.");
    this.name = "XeroNotConnectedError";
  }
}

// --- OAuth2 -----------------------------------------------------------------

export function buildAuthorizeUrl(state: string): string {
  const config = getXeroConfig();
  const url = new URL(XERO_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", XERO_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

function basicAuthHeader(): string {
  const config = getXeroConfig();
  const encoded = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  return `Basic ${encoded}`;
}

async function postToken(body: URLSearchParams, endpoint: string): Promise<TokenResponse> {
  const response = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    // Xero returns {"error":"invalid_grant"} for an expired/reused refresh token — the most
    // common real failure. Surface the code, never the token that produced it.
    const parsed = TokenErrorResponse.safeParse(safeJson(text));
    const detail = parsed.success
      ? `${parsed.data.error}${parsed.data.error_description ? ` — ${parsed.data.error_description}` : ""}`
      : "unreadable error body";
    throw new XeroApiError(response.status, endpoint, detail);
  }

  const parsed = TokenResponse.safeParse(safeJson(text));
  if (!parsed.success) {
    throw new XeroApiError(response.status, endpoint, `unexpected token payload: ${issues(parsed.error)}`);
  }
  return parsed.data;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const config = getXeroConfig();
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
    "token exchange",
  );
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    "token refresh",
  );
}

export async function fetchConnections(accessToken: string): Promise<XeroTenantConnection[]> {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new XeroApiError(response.status, "/connections", truncate(text));
  }
  const parsed = ConnectionsResponse.safeParse(safeJson(text));
  if (!parsed.success) {
    throw new XeroApiError(response.status, "/connections", `unexpected payload: ${issues(parsed.error)}`);
  }
  return parsed.data.map((connection) => ({
    connectionId: connection.id,
    tenantId: connection.tenantId,
    tenantName: connection.tenantName ?? "(unnamed organisation)",
    tenantType: connection.tenantType,
  }));
}

/** Build the persisted state from a fresh token response plus its authorised orgs. */
export function toTokenState(
  tokens: TokenResponse,
  connections: readonly XeroTenantConnection[],
  previous: XeroTokenState | null,
  now: number,
): XeroTokenState {
  const stillAuthorised =
    previous?.activeTenantId &&
    connections.some((connection) => connection.tenantId === previous.activeTenantId)
      ? previous.activeTenantId
      : null;

  // NOTE when `connections` is empty. That means Xero no longer reports any authorised
  // organisation — the app was disconnected from Xero's side, or a Demo Company hit its
  // 28-day reset. We still persist: the refresh token has already rotated, so discarding this
  // result would throw away the only working credential and kill the connection outright.
  // The empty state is therefore recorded faithfully, and `connectionPrompt` in ./index.ts
  // turns it into an explanation rather than a screen with nothing on it.
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: now + tokens.expires_in * 1000,
    scope: tokens.scope,
    connections,
    // Bind automatically only when the choice is unambiguous. With several orgs authorised,
    // picking connections[0] would silently read the wrong company's books.
    activeTenantId: stillAuthorised ?? (connections.length === 1 ? connections[0]!.tenantId : null),
    connectedAt: previous?.connectedAt ?? new Date(now).toISOString(),
  };
}

// --- Token lifecycle --------------------------------------------------------

export async function getConnectionState(): Promise<XeroTokenState | null> {
  return getXeroTokenStore().read();
}

/**
 * Current access token, refreshed and re-persisted first if it is at or near expiry.
 *
 * Xero refresh tokens are single-use: two concurrent refreshes race, and whichever lands
 * second presents an already-spent token, gets `invalid_grant`, and the connection is dead
 * until the user re-authorises. Two page loads at once is enough to trigger it.
 *
 * Serialisation is delegated to the store, because only the store knows how far its lock
 * actually reaches — one process for the file store, every process for the database. An
 * in-process promise here would look correct and do nothing on serverless.
 */
export async function getValidAccessToken(): Promise<XeroTokenState> {
  const store = getXeroTokenStore();
  const state = await store.read();
  if (!state) throw new XeroNotConnectedError();

  if (Date.now() < state.expiresAt - TOKEN_REFRESH_LEEWAY_MS) {
    return state;
  }

  return store.withRefreshLock(async () => {
    // Re-read under the lock. Waiting for it may have taken a while, and whoever held it
    // before us has rotated the refresh token that `state` is still holding.
    const current = await store.read();
    if (!current) throw new XeroNotConnectedError();
    if (Date.now() < current.expiresAt - TOKEN_REFRESH_LEEWAY_MS) {
      return current;
    }

    const tokens = await refreshTokens(current.refreshToken);
    // Re-read connections: an org can be disconnected from inside Xero at any time.
    const connections = await fetchConnections(tokens.access_token);
    const next = toTokenState(tokens, connections, current, Date.now());
    // Persist BEFORE returning — the rotated refresh token is now the only working one.
    await store.write(next);
    return next;
  });
}

// --- Authorised reads -------------------------------------------------------

interface XeroGetOptions {
  tenantId: string;
  searchParams?: Record<string, string>;
}

async function xeroGet(path: string, options: XeroGetOptions): Promise<unknown> {
  const state = await getValidAccessToken();
  const url = new URL(`${XERO_API_BASE}${path}`);
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      // Required on every Accounting API call — without it Xero does not know which org.
      "Xero-Tenant-Id": options.tenantId,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    throw new XeroRateLimitError(
      path,
      Number.isFinite(retryAfter) ? retryAfter : null,
      response.headers.get("X-Rate-Limit-Problem"),
    );
  }
  if (!response.ok) {
    throw new XeroApiError(response.status, path, truncate(await response.text()));
  }
  return safeJson(await response.text());
}

export async function fetchOrganisation(tenantId: string): Promise<XeroOrganisation | null> {
  const body = await xeroGet("/Organisation", { tenantId });
  const parsed = OrganisationsResponse.safeParse(body);
  if (!parsed.success) {
    throw new XeroApiError(200, "/Organisation", `unexpected payload: ${issues(parsed.error)}`);
  }
  return parsed.data.Organisations[0] ?? null;
}

interface CacheEntry {
  accounts: XeroAccount[];
  fetchedAt: number;
}
const chartOfAccountsCache = new Map<string, CacheEntry>();

/**
 * Chart of accounts, cached per org.
 *
 * It changes about never and is read on every page load, so at 5,000 calls/day it is the
 * cheapest thing to cache and the most wasteful not to. In-process only — Spec 2 moves it
 * to the database alongside ingestion.
 */
export async function fetchChartOfAccounts(
  tenantId: string,
  options: { force?: boolean } = {},
): Promise<{ accounts: XeroAccount[]; cached: boolean; fetchedAt: number }> {
  const cached = chartOfAccountsCache.get(tenantId);
  if (!options.force && cached && Date.now() - cached.fetchedAt < CHART_OF_ACCOUNTS_TTL_MS) {
    return { accounts: cached.accounts, cached: true, fetchedAt: cached.fetchedAt };
  }

  const body = await xeroGet("/Accounts", { tenantId });
  const parsed = AccountsResponse.safeParse(body);
  if (!parsed.success) {
    throw new XeroApiError(200, "/Accounts", `unexpected payload: ${issues(parsed.error)}`);
  }
  const entry: CacheEntry = { accounts: parsed.data.Accounts, fetchedAt: Date.now() };
  chartOfAccountsCache.set(tenantId, entry);
  return { accounts: entry.accounts, cached: false, fetchedAt: entry.fetchedAt };
}

export function clearChartOfAccountsCache(): void {
  chartOfAccountsCache.clear();
}

export interface FetchInvoicesResult {
  invoices: XeroInvoice[];
  /**
   * True when the page bound was reached with more still available.
   *
   * The caller needs to distinguish "this is everything outstanding" from "this is the first
   * 200 of an unknown number". A total over an unknown subset looks identical to a complete
   * one, which is the failure this flag exists to make visible.
   */
  truncated: boolean;
}

export interface FetchInvoicesOptions {
  /** Xero invoice statuses to include. Defaults to those representing real commitments. */
  statuses?: readonly string[];
  /**
   * Xero pages at 100 invoices. Bounded so one read cannot burn the daily call budget —
   * but the bound is now deliberately generous, because JENKI proved 2 pages was not enough
   * to hold even one organisation's outstanding set.
   */
  maxPages?: number;
}

export async function fetchInvoices(
  tenantId: string,
  options: FetchInvoicesOptions = {},
): Promise<FetchInvoicesResult> {
  // DRAFT is excluded: a draft is not yet a commitment and must not appear as expected cash.
  //
  // PAID is excluded too, and that is the point of spec-1b. Including it spent the page bound
  // on settled invoices, so which outstanding ones survived was decided by the date window
  // rather than by being outstanding. Ascending order returned JENKI's oldest — all paid,
  // both totals blank. Descending returned the furthest-future due dates, which on an org
  // with forward-dated invoices pushes OVERDUE ones below the cut: the most cash-relevant
  // invoices a business has, silently missing from a total that looked authoritative.
  //
  // Selecting by status rather than filtering on AmountDue is deliberate: Statuses is a
  // documented first-class parameter already proven here, whereas a where clause on a
  // computed field is outside Xero's optimised set and risks timeouts on exactly the large
  // orgs this is meant to serve. An invoice credited to zero while still AUTHORISED is
  // handled downstream — core/position.ts ignores any commitment whose amountDue is zero.
  const statuses = options.statuses ?? ["AUTHORISED", "SUBMITTED"];
  // 10 pages -> up to 1,000 invoices. Two was not enough: JENKI filled it entirely with
  // future-dated invoices and the truncation notice fired on every load. Costs up to 10
  // calls per uncached read against 60/min and 5,000/day, so roughly 380 page loads a day
  // for one organisation — comfortable now, worth revisiting when there are several.
  const maxPages = options.maxPages ?? 10;
  const invoices: XeroInvoice[] = [];
  let truncated = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const body = await xeroGet("/Invoices", {
      tenantId,
      searchParams: {
        Statuses: statuses.join(","),
        page: String(page),
        // ASCENDING — oldest first, which now means MOST OVERDUE first.
        //
        // The history here matters, because ascending was the original bug. It failed then
        // only because PAID was included, so "oldest" meant "settled years ago": JENKI's
        // oldest 200 were due 2020-11 to 2021-09 and every one had been paid, leaving both
        // totals blank. Flipping to DESC fixed that symptom and introduced a worse one —
        // the furthest-future due dates filled all 200 slots, so not one OVERDUE invoice
        // reached the position. Those are the invoices a business most needs to see.
        //
        // With PAID excluded (spec-1b) ascending is correct on its own terms: oldest
        // outstanding IS most overdue. And if the bound still truncates, it now drops
        // invoices due next spring rather than ones that were due last month.
        order: "DueDate ASC",
      },
    });
    const parsed = InvoicesResponse.safeParse(body);
    if (!parsed.success) {
      throw new XeroApiError(200, "/Invoices", `unexpected payload: ${issues(parsed.error)}`);
    }
    invoices.push(...parsed.data.Invoices);
    if (parsed.data.Invoices.length < 100) break; // short page — the set is complete
    // A full page on the final iteration means Xero had more and we stopped asking.
    if (page === maxPages) truncated = true;
  }

  return { invoices, truncated };
}

export interface FetchBankTransactionsResult {
  transactions: XeroBankTransaction[];
  /**
   * True when the page bound was reached with more still available.
   *
   * Invoices got this flag in spec-1b; bank transactions never did, and the cost was concrete.
   * At the old bound of 2 pages JENKI's 200 rows covered about 14 days — roughly 14
   * transactions a day — and the screen presented that as the whole picture. Note the cap is on
   * ROWS, not days, so the visible window silently narrows as the business gets busier: a
   * seasonal spike in card takings shortens the history with no code change at all.
   */
  truncated: boolean;
}

export interface FetchBankTransactionsOptions {
  /** Xero statuses to include. Defaults to AUTHORISED — the ones that really moved money. */
  statuses?: readonly string[];
  /** Xero pages at 100. Bounded so one page load cannot burn the daily call budget. */
  maxPages?: number;
}

/**
 * Xero's own record of money through a bank account, from the ledger — not a bank feed.
 *
 * Mirrors `fetchInvoices`, with one deliberate difference: `/BankTransactions` has no
 * `Statuses` shorthand, so the same intent (exclude what did not really happen) is expressed
 * as a `where` clause. DELETED and VOIDED entries are excluded for the same reason DRAFT
 * invoices are: they are not movements of cash.
 */
export async function fetchBankTransactions(
  tenantId: string,
  options: FetchBankTransactionsOptions = {},
): Promise<FetchBankTransactionsResult> {
  const statuses = options.statuses ?? ["AUTHORISED"];
  // 10 pages, matching fetchInvoices. Two was measurably too few — see the note on
  // FetchBankTransactionsResult.truncated.
  const maxPages = options.maxPages ?? 10;
  const transactions: XeroBankTransaction[] = [];
  let truncated = false;
  const where = statuses.map((status) => `Status=="${status}"`).join(" OR ");

  for (let page = 1; page <= maxPages; page += 1) {
    const body = await xeroGet("/BankTransactions", {
      tenantId,
      searchParams: { where, page: String(page), order: "Date DESC" },
    });
    const parsed = BankTransactionsResponse.safeParse(body);
    if (!parsed.success) {
      throw new XeroApiError(200, "/BankTransactions", `unexpected payload: ${issues(parsed.error)}`);
    }
    transactions.push(...parsed.data.BankTransactions);
    if (parsed.data.BankTransactions.length < 100) break; // short page — the set is complete
    // A full page on the final iteration means Xero had more and we stopped asking.
    if (page === maxPages) truncated = true;
  }

  return { transactions, truncated };
}

// --- the payment family -----------------------------------------------------
//
// Four endpoints, one scope. /BankTransactions only ever carried direct bank-level entries, so
// a payment matched against an invoice never appeared there at any page depth — this is where
// that money actually lives. All four follow the same shape as fetchBankTransactions: same
// xeroGet path, so they inherit the Xero-Tenant-Id header, 429 handling and zod validation at
// the boundary; same page bound; same honest truncation flag.

export interface PagedResult<T> {
  items: T[];
  /** True when the bound was hit with more available. A subset, not the whole. */
  truncated: boolean;
}

export interface FetchPagedOptions {
  maxPages?: number;
}

/**
 * Shared paging loop for the payment family.
 *
 * Deliberately generic: four endpoints that page identically should not have four copies of the
 * same off-by-one risk. `order` is per-endpoint because the right end of history differs —
 * payments answer "what moved recently", so newest first.
 */
async function fetchPaged<T>(
  path: string,
  key: string,
  parse: (body: unknown) => { success: true; items: T[] } | { success: false; detail: string },
  tenantId: string,
  query: { order: string; where?: string },
  options: FetchPagedOptions = {},
): Promise<PagedResult<T>> {
  const maxPages = options.maxPages ?? 10;
  const items: T[] = [];
  let truncated = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const searchParams: Record<string, string> = { page: String(page), order: query.order };
    if (query.where) searchParams.where = query.where;
    const body = await xeroGet(path, { tenantId, searchParams });
    const parsed = parse(body);
    if (!parsed.success) {
      throw new XeroApiError(200, path, `unexpected payload: ${parsed.detail}`);
    }
    items.push(...parsed.items);
    if (parsed.items.length < 100) break; // short page — the set is complete
    if (page === maxPages) truncated = true;
  }
  void key;
  return { items, truncated };
}

/**
 * Status filter as a `where` clause.
 *
 * `Statuses=` is silently IGNORED across this API's endpoints — confirmed on /Payments
 * (Statuses=DELETED returned a mix of AUTHORISED and DELETED) and on /CreditNotes. `where`
 * is honoured everywhere it has been tested, including /BatchPayments, where `page` is not.
 * An empty list is rejected rather than treated as a wildcard: no filter would quietly
 * include cancelled records, which is the failure this exists to prevent.
 */
function statusWhere(statuses: readonly string[], path: string): string {
  if (statuses.length === 0) {
    throw new XeroApiError(0, path, "statuses must not be empty");
  }
  return statuses.map((status) => `Status=="${status}"`).join("||");
}

export interface FetchPaymentsOptions extends FetchPagedOptions {
  /**
   * Payment statuses to include. Defaults to AUTHORISED only.
   *
   * DELETED is excluded because Xero keeps the amounts on cancelled payments: 100 of 100
   * sampled DELETED records carried a non-zero Amount, and about a fifth of an unfiltered
   * read is DELETED. VOIDED does not occur on /Payments (0 records).
   */
  statuses?: readonly string[];
}

export async function fetchPayments(
  tenantId: string,
  options: FetchPaymentsOptions = {},
): Promise<PagedResult<XeroPayment>> {
  return fetchPaged<XeroPayment>(
    "/Payments",
    "Payments",
    (body) => {
      const p = PaymentsResponse.safeParse(body);
      return p.success
        ? { success: true, items: p.data.Payments }
        : { success: false, detail: issues(p.error) };
    },
    tenantId,
    { order: "Date DESC", where: statusWhere(options.statuses ?? ["AUTHORISED"], "/Payments") },
    options,
  );
}

export interface FetchBatchPaymentsOptions {
  /** Batch statuses to include. Defaults to AUTHORISED; DELETED batches are 75 of 1,421. */
  statuses?: readonly string[];
}

/**
 * Batch payments — ONE unpaginated request, deliberately not via `fetchPaged`.
 *
 * Xero IGNORES `page` on this endpoint. `page=1` and `page=99` both return the complete set
 * of 1,421 records. `fetchPaged` terminates only on a page shorter than 100, so it would
 * have requested all ten pages, appended the same 1,421 records each time for **14,210
 * duplicates**, and then reported `truncated: true` — which inverts the truth twice over:
 * nothing was truncated, and everything was duplicated.
 *
 * `fetchPaged` is NOT generalised to cope with this. Every other endpoint here genuinely
 * paginates, and loosening that loop's contract to accommodate one exception would put every
 * other endpoint at risk of silently stopping early. The exception gets its own function.
 *
 * `truncated` is therefore always false, and that is a statement about Xero rather than a
 * default: one call returns everything, so there is no bound to report.
 *
 * `where` IS honoured here even though `page` is not — verified, 1,346 AUTHORISED and 75
 * DELETED of 1,421.
 */
export async function fetchBatchPayments(
  tenantId: string,
  options: FetchBatchPaymentsOptions = {},
): Promise<PagedResult<XeroBatchPayment>> {
  const body = await xeroGet("/BatchPayments", {
    tenantId,
    // No `page`. Sending it would be harmless but misleading: it implies a bound that Xero
    // does not apply, and the next reader would assume this loops.
    searchParams: {
      order: "Date DESC",
      where: statusWhere(options.statuses ?? ["AUTHORISED"], "/BatchPayments"),
    },
  });
  const parsed = BatchPaymentsResponse.safeParse(body);
  if (!parsed.success) {
    throw new XeroApiError(200, "/BatchPayments", `unexpected payload: ${issues(parsed.error)}`);
  }
  return { items: parsed.data.BatchPayments, truncated: false };
}

export async function fetchPrepayments(
  tenantId: string,
  options: FetchPagedOptions = {},
): Promise<PagedResult<XeroUnallocatedCredit>> {
  return fetchPaged<XeroUnallocatedCredit>(
    "/Prepayments",
    "Prepayments",
    (body) => {
      const p = PrepaymentsResponse.safeParse(body);
      return p.success
        ? { success: true, items: p.data.Prepayments }
        : { success: false, detail: issues(p.error) };
    },
    tenantId,
    // Deliberately UNFILTERED. VOIDED credits carry a phantom RemainingCredit, but the
    // normaliser's `creditIsLive` handles that, and PAID records are needed for allocation
    // history — filtering them out at the fetch would throw away how a credit was consumed.
    { order: "Date DESC" },
    options,
  );
}

export async function fetchOverpayments(
  tenantId: string,
  options: FetchPagedOptions = {},
): Promise<PagedResult<XeroUnallocatedCredit>> {
  return fetchPaged<XeroUnallocatedCredit>(
    "/Overpayments",
    "Overpayments",
    (body) => {
      const p = OverpaymentsResponse.safeParse(body);
      return p.success
        ? { success: true, items: p.data.Overpayments }
        : { success: false, detail: issues(p.error) };
    },
    tenantId,
    // Unfiltered for the same reason as prepayments — see above.
    { order: "Date DESC" },
    options,
  );
}

// --- helpers ----------------------------------------------------------------

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Error bodies can echo request content. Cap them so nothing large lands in a log. */
function truncate(text: string, max = 300): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

export interface FetchCreditNotesResult {
  creditNotes: XeroCreditNote[];
  /** True when the page bound was reached with more still available. */
  truncated: boolean;
}

export interface FetchCreditNotesOptions {
  /**
   * Xero credit note statuses to include. Defaults to those where unapplied credit is real.
   *
   * Excluding VOIDED and DELETED is not tidiness. Xero keeps `RemainingCredit` populated on
   * cancelled credit notes: of JENKI's 600 surveyed, 317 carried a non-zero remaining credit
   * and every one of those was VOIDED or DELETED. Reading them in would put cancelled
   * paperwork into a figure labelled available credit.
   */
  statuses?: readonly string[];
  /** Xero pages at 100. Bounded so one read cannot burn the daily call budget. */
  maxPages?: number;
}

/**
 * Credit notes, with line items and the tracking that makes site attribution possible.
 *
 * TWO THINGS HERE ARE NOT OPTIONAL, both established by surveying JENKI's live data on
 * 2026-10-22 rather than from documentation.
 *
 * 1. `page` MUST be sent on every request. `GET /CreditNotes` without it returns all 1,578 of
 *    JENKI's credit notes with `LineItems: []` — no error, no warning, just no line items.
 *    With `page=1` the same records arrive with line items populated. Since `Tracking` lives
 *    on the line item, an unpaginated read silently discards the Site and Revenue Centre
 *    attribution that is the reason to read this endpoint at all. This is the same class of
 *    defect as the `LineItems.Description` bug on bank transactions: a plausible request, a
 *    complete-looking response, and missing data. The loop below starts at page 1 and always
 *    sends the parameter; there is no code path that omits it.
 *
 * 2. Status selection goes through `where`, NOT `Statuses`. `Statuses=AUTHORISED` is silently
 *    IGNORED on this endpoint — it returns the unfiltered first page, PAID and VOIDED
 *    included. Copying `fetchInvoices`' use of `Statuses` here would have looked correct,
 *    compiled, returned 200, and filtered nothing. `where=Status=="AUTHORISED"` returns 23
 *    records, all AUTHORISED, which is the real outstanding set.
 *
 * Ordered by Date DESC rather than DueDate: `DueDate` is populated on only ~9% of JENKI's
 * credit notes, so ordering by it would sort almost the entire set by a missing field.
 */
export async function fetchCreditNotes(
  tenantId: string,
  options: FetchCreditNotesOptions = {},
): Promise<FetchCreditNotesResult> {
  const statuses = options.statuses ?? ["AUTHORISED", "SUBMITTED"];
  const maxPages = options.maxPages ?? 10;
  const creditNotes: XeroCreditNote[] = [];
  let truncated = false;

  // Built as an OR over the requested statuses, which is what Xero's where syntax supports.
  // An empty list would mean "no filter", which would silently include cancelled credit
  // notes — so it is rejected rather than treated as a wildcard.
  if (statuses.length === 0) {
    throw new XeroApiError(0, "/CreditNotes", "statuses must not be empty");
  }
  const where = statuses.map((status) => `Status=="${status}"`).join("||");

  for (let page = 1; page <= maxPages; page += 1) {
    const body = await xeroGet("/CreditNotes", {
      tenantId,
      searchParams: {
        // Always present. See note 1 above — omitting this strips every line item.
        page: String(page),
        where,
        order: "Date DESC",
      },
    });
    const parsed = CreditNotesResponse.safeParse(body);
    if (!parsed.success) {
      throw new XeroApiError(200, "/CreditNotes", `unexpected payload: ${issues(parsed.error)}`);
    }
    creditNotes.push(...parsed.data.CreditNotes);
    if (parsed.data.CreditNotes.length < 100) break; // short page — the set is complete
    if (page === maxPages) truncated = true;
  }

  return { creditNotes, truncated };
}
