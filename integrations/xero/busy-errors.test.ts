import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  XeroApiError,
  XeroRateLimitError,
  fetchOrganisation,
  clearChartOfAccountsCache,
} from "./client";
import { setXeroTokenStore, type XeroTokenState, type XeroTokenStore } from "./tokens";

/**
 * Xero's failures, split by what the operator can do about them, and the rate headers logged.
 *
 * Both exist because of the same measured incident (2026-10-28): a Xero-side 503 was rendered
 * as an authorisation problem, and the remaining daily budget was invisible because nothing
 * ever logged it.
 */

const TENANT = "tenant-abc";

class MemoryStore implements XeroTokenStore {
  constructor(public state: XeroTokenState | null) {}
  async read() {
    return this.state;
  }
  async write(state: XeroTokenState) {
    this.state = state;
  }
  async clear() {
    this.state = null;
  }
  async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

function connected(): XeroTokenState {
  return {
    accessToken: "access-live",
    refreshToken: "refresh-live",
    expiresAt: Date.now() + 30 * 60 * 1000,
    scope: "accounting.settings.read",
    connections: [
      { connectionId: "c-1", tenantId: TENANT, tenantName: "Demo Co", tenantType: "ORGANISATION" },
    ],
    activeTenantId: TENANT,
    connectedAt: "2026-07-01T00:00:00.000Z",
  };
}

function stubFetch(status: number, headers: Record<string, string> = {}, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  clearChartOfAccountsCache();
  setXeroTokenStore(new MemoryStore(connected()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isBusy", () => {
  // The table IS the specification. 401 and 403 are the only statuses for which asking the
  // user to re-authorise is a real remedy; everything else must not offer it.
  const cases: Array<[number, boolean]> = [
    [429, true],
    [500, true],
    [502, true],
    [503, true],
    [504, true],
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [422, false],
  ];

  for (const [status, busy] of cases) {
    it(`treats ${status} as ${busy ? "busy" : "not busy"}`, () => {
      expect(new XeroApiError(status, "/Organisation", "detail").isBusy).toBe(busy);
    });
  }

  it("classifies a rate limit error as busy and keeps its Retry-After", () => {
    const error = new XeroRateLimitError("/Organisation", 37, "day");
    expect(error.isBusy).toBe(true);
    expect(error.retryAfterSeconds).toBe(37);
    expect(error.status).toBe(429);
  });

  it("defaults Retry-After to null rather than zero", () => {
    // Zero would render as "try again in 0 seconds", which reads as advice and is not.
    expect(new XeroApiError(503, "/Organisation", "overflow").retryAfterSeconds).toBeNull();
  });
});

describe("Retry-After from the response", () => {
  it("is carried onto a 503, not only onto a 429", async () => {
    stubFetch(503, { "retry-after": "12" }, {});
    await expect(fetchOrganisation(TENANT)).rejects.toMatchObject({
      status: 503,
      retryAfterSeconds: 12,
    });
  });

  it("is null when Xero sends an HTTP-date rather than seconds", async () => {
    // Legal HTTP, and Number() of it is NaN. Reported absent rather than shown as "NaN".
    stubFetch(503, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, {});
    await expect(fetchOrganisation(TENANT)).rejects.toMatchObject({
      retryAfterSeconds: null,
    });
  });

  it("is read on a 429 together with the limit type", async () => {
    stubFetch(429, { "retry-after": "60", "x-rate-limit-problem": "day" }, {});
    await expect(fetchOrganisation(TENANT)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
      limitType: "day",
    });
  });
});

describe("rate-header logging", () => {
  it("logs the day and minute remaining on a SUCCESSFUL response", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    stubFetch(
      200,
      { "x-daylimit-remaining": "975", "x-minlimit-remaining": "57" },
      { Organisations: [{ OrganisationID: "o", Name: "Demo Co", BaseCurrency: "GBP" }] },
    );

    await fetchOrganisation(TENANT);

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain("/Organisation");
    expect(line).toContain("200");
    expect(line).toContain("day=975");
    expect(line).toContain("min=57");
  });

  it("logs on a FAILED response too, which is when the number matters most", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    stubFetch(429, {
      "x-daylimit-remaining": "0",
      "x-minlimit-remaining": "0",
      "x-rate-limit-problem": "day",
      "retry-after": "90",
    });

    await expect(fetchOrganisation(TENANT)).rejects.toBeInstanceOf(XeroRateLimitError);

    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain("day=0");
    expect(line).toContain("problem=day");
    expect(line).toContain("retryAfter=90");
  });

  it("records a missing header as '-' rather than as zero", async () => {
    // "day=0" and "day unknown" are different facts; one is an emergency.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    stubFetch(200, {}, { Organisations: [{ OrganisationID: "o", Name: "D", BaseCurrency: "GBP" }] });

    await fetchOrganisation(TENANT);

    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain("day=-");
    expect(line).toContain("min=-");
    expect(line).not.toContain("day=0");
  });

  it("logs no query string, so a where clause cannot leak a supplier name", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    stubFetch(200, {}, { Organisations: [{ OrganisationID: "o", Name: "D", BaseCurrency: "GBP" }] });

    await fetchOrganisation(TENANT);

    const line = String(info.mock.calls[0]?.[0]);
    expect(line).not.toContain("?");
    expect(line).not.toContain("where");
  });
});
