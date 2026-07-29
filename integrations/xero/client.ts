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
  ConnectionsResponse,
  InvoicesResponse,
  OrganisationsResponse,
  TokenErrorResponse,
  TokenResponse,
  type XeroAccount,
  type XeroInvoice,
  type XeroOrganisation,
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

/**
 * Serialises refreshes within the process.
 *
 * Xero refresh tokens are single-use: two concurrent refreshes race, and whichever lands
 * second presents an already-spent token, gets `invalid_grant`, and the connection is dead
 * until the user re-authorises. Two page loads at once is enough to trigger it.
 */
let refreshInFlight: Promise<XeroTokenState> | null = null;

export async function getConnectionState(): Promise<XeroTokenState | null> {
  return getXeroTokenStore().read();
}

/** Current access token, refreshed and re-persisted first if it is at or near expiry. */
export async function getValidAccessToken(): Promise<XeroTokenState> {
  const store = getXeroTokenStore();
  const state = await store.read();
  if (!state) throw new XeroNotConnectedError();

  if (Date.now() < state.expiresAt - TOKEN_REFRESH_LEEWAY_MS) {
    return state;
  }

  refreshInFlight ??= (async () => {
    try {
      const tokens = await refreshTokens(state.refreshToken);
      // Re-read connections: an org can be disconnected from inside Xero at any time.
      const connections = await fetchConnections(tokens.access_token);
      const next = toTokenState(tokens, connections, state, Date.now());
      // Persist BEFORE returning — the rotated refresh token is now the only working one.
      await store.write(next);
      return next;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
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

export interface FetchInvoicesOptions {
  /** Xero invoice statuses to include. Defaults to those representing real commitments. */
  statuses?: readonly string[];
  /** Xero pages at 100 invoices. Bounded so one read cannot burn the daily call budget. */
  maxPages?: number;
}

export async function fetchInvoices(
  tenantId: string,
  options: FetchInvoicesOptions = {},
): Promise<XeroInvoice[]> {
  // DRAFT is excluded: a draft is not yet a commitment and must not appear as expected cash.
  const statuses = options.statuses ?? ["AUTHORISED", "SUBMITTED", "PAID"];
  const maxPages = options.maxPages ?? 2;
  const invoices: XeroInvoice[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const body = await xeroGet("/Invoices", {
      tenantId,
      searchParams: {
        Statuses: statuses.join(","),
        page: String(page),
        order: "DueDate",
      },
    });
    const parsed = InvoicesResponse.safeParse(body);
    if (!parsed.success) {
      throw new XeroApiError(200, "/Invoices", `unexpected payload: ${issues(parsed.error)}`);
    }
    invoices.push(...parsed.data.Invoices);
    if (parsed.data.Invoices.length < 100) break; // short page — no more to fetch
  }

  return invoices;
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
