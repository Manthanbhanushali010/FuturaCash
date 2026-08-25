import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, middleware } from "./middleware";
import { GATE_COOKIE, gateDigest } from "./lib/page-gate";

/**
 * Exercises the real middleware function, so a change to the gate — or to the matcher —
 * fails here rather than being discovered on a live URL.
 *
 * The previous verification for this was a hand-run curl session. That proved the behaviour
 * once; it would not have noticed someone narrowing the matcher three months from now.
 */

const PASSWORD = "gate-password-under-test";
const ORIGIN = "https://www.futuracash.co.uk";

function request(
  path: string,
  options: { cookie?: string; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie !== undefined) headers.set("cookie", `${GATE_COOKIE}=${options.cookie}`);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

/** NextResponse.next() is a pass-through, marked by this internal header. */
function isPassThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

const BROWSER = { "sec-fetch-mode": "navigate", accept: "text/html,application/xhtml+xml" };
const PROGRAMMATIC = { accept: "application/json" };

let original: string | undefined;
let validCookie: string;

beforeEach(async () => {
  original = process.env.XERO_PAGE_PASSWORD;
  process.env.XERO_PAGE_PASSWORD = PASSWORD;
  validCookie = await gateDigest(PASSWORD);
});
afterEach(() => {
  if (original === undefined) delete process.env.XERO_PAGE_PASSWORD;
  else process.env.XERO_PAGE_PASSWORD = original;
});

describe("gate: /xero page", () => {
  it("redirects an unauthenticated request to the password prompt", async () => {
    const response = await middleware(request("/xero", { headers: BROWSER }));
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/unlock");
    expect(location).toContain("next=%2Fxero");
  });

  it("does not leak the connection UI in the redirect body", async () => {
    const response = await middleware(request("/xero", { headers: BROWSER }));
    expect(await response.text()).not.toContain("Connect to Xero");
  });

  it("rejects a wrong cookie", async () => {
    const response = await middleware(request("/xero", { cookie: "deadbeef", headers: BROWSER }));
    expect(response.status).toBe(307);
  });

  it("rejects the raw password presented as a cookie", async () => {
    const response = await middleware(request("/xero", { cookie: PASSWORD, headers: BROWSER }));
    expect(response.status).toBe(307);
  });

  it("lets an authenticated request through", async () => {
    const response = await middleware(request("/xero", { cookie: validCookie, headers: BROWSER }));
    expect(isPassThrough(response)).toBe(true);
  });

  it("preserves the query string in the return path", async () => {
    const response = await middleware(request("/xero?tab=invoices", { headers: BROWSER }));
    expect(response.headers.get("location")).toContain("next=%2Fxero%3Ftab%3Dinvoices");
  });
});

describe("gate: /api/xero/* routes", () => {
  it("returns 401 to an unauthenticated programmatic request", async () => {
    const response = await middleware(request("/api/xero/connect", { headers: PROGRAMMATIC }));
    expect(response.status).toBe(401);
  });

  it("returns 401 with no data in the body", async () => {
    const response = await middleware(request("/api/xero/disconnect", { headers: PROGRAMMATIC }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "unauthorized", message: expect.any(String) });
  });

  it("returns 401 when no headers are sent at all (curl, scripts)", async () => {
    const response = await middleware(request("/api/xero/select-tenant"));
    expect(response.status).toBe(401);
  });

  it("is not cacheable, so a 401 cannot be served to someone authenticated", async () => {
    const response = await middleware(request("/api/xero/connect", { headers: PROGRAMMATIC }));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("redirects a browser NAVIGATION to the prompt instead of 401", async () => {
    // "Get started" on the landing page points at this route; a bare 401 would dead-end it.
    const response = await middleware(request("/api/xero/connect", { headers: BROWSER }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/unlock");
  });

  it("lets an authenticated request through", async () => {
    const response = await middleware(
      request("/api/xero/connect", { cookie: validCookie, headers: PROGRAMMATIC }),
    );
    expect(isPassThrough(response)).toBe(true);
  });

  it("gates the OAuth callback too", async () => {
    const response = await middleware(request("/api/xero/callback?code=abc", { headers: PROGRAMMATIC }));
    expect(response.status).toBe(401);
  });
});

describe("gate: fails closed", () => {
  it("blocks the page when no password is configured", async () => {
    delete process.env.XERO_PAGE_PASSWORD;
    const response = await middleware(request("/xero", { cookie: validCookie, headers: BROWSER }));
    expect(response.status).toBe(307);
  });

  it("blocks the routes when no password is configured", async () => {
    delete process.env.XERO_PAGE_PASSWORD;
    const response = await middleware(
      request("/api/xero/connect", { cookie: validCookie, headers: PROGRAMMATIC }),
    );
    expect(response.status).toBe(401);
  });
});

describe("gate: matcher coverage", () => {
  it("covers the page and every Xero route", () => {
    expect(config.matcher).toContain("/xero/:path*");
    expect(config.matcher).toContain("/api/xero/:path*");
  });

  it("does not gate /unlock or /api/unlock — that would be a redirect loop", () => {
    for (const pattern of config.matcher) {
      expect(pattern).not.toContain("unlock");
    }
  });

  it("does not gate the landing page", () => {
    expect(config.matcher).not.toContain("/");
    expect(config.matcher).not.toContain("/:path*");
  });
});
