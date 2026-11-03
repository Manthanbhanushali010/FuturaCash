import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATE_COOKIE, gateDigest } from "@/lib/page-gate";
import { config, middleware } from "@/middleware";

/**
 * The batch drill-down is behind the same gate as everything else.
 *
 * Asserted against the REAL middleware and the real matcher rather than reasoned about: the
 * page relies on `/xero/:path*` matching deeper segments, which is a property of the matcher
 * and not of this page. If someone narrows that matcher to `/xero` the drill-down would serve
 * supplier names to anyone with the URL, and this is what fails.
 */

const PASSWORD = "gate-password-under-test";
const ORIGIN = "https://www.futuracash.co.uk";
const BATCH_ID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";
const PATH = `/xero/batches/${BATCH_ID}`;

const BROWSER = { "sec-fetch-mode": "navigate", accept: "text/html,application/xhtml+xml" };

function request(path: string, options: { cookie?: string } = {}): NextRequest {
  const headers = new Headers(BROWSER);
  if (options.cookie !== undefined) headers.set("cookie", `${GATE_COOKIE}=${options.cookie}`);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

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

describe("gate: the batch drill-down page", () => {
  it("REFUSES an unauthenticated request", async () => {
    const response = await middleware(request(PATH));
    expect(response.status).toBe(307);
    expect(response.headers.get("location") ?? "").toContain("/unlock");
  });

  it("sends the visitor back to the batch after unlocking", async () => {
    const response = await middleware(request(PATH));
    expect(response.headers.get("location") ?? "").toContain(
      `next=${encodeURIComponent(PATH)}`,
    );
  });

  it("refuses a wrong cookie", async () => {
    const response = await middleware(request(PATH, { cookie: "deadbeef" }));
    expect(response.status).toBe(307);
  });

  it("refuses the raw password presented as a cookie", async () => {
    const response = await middleware(request(PATH, { cookie: PASSWORD }));
    expect(response.status).toBe(307);
  });

  it("refuses when no password is configured — fails closed", async () => {
    delete process.env.XERO_PAGE_PASSWORD;
    const response = await middleware(request(PATH, { cookie: validCookie }));
    expect(response.status).toBe(307);
  });

  it("allows a correctly authenticated request through", async () => {
    const response = await middleware(request(PATH, { cookie: validCookie }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("the matcher covers nested paths under /xero, which this page depends on", () => {
    // `:path*` matches zero or more segments. A matcher of exactly "/xero" would leave this
    // page ungated, and the assertion above would still pass for the wrong reason.
    expect(config.matcher).toContain("/xero/:path*");
  });

  it("refuses an unauthenticated request even with a malformed id", async () => {
    // The gate must come before validation: an invalid id is still not a reason to serve the
    // page to someone who has not unlocked it.
    const response = await middleware(request("/xero/batches/not-a-guid"));
    expect(response.status).toBe(307);
  });
});
