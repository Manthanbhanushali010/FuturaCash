import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { XeroApiError, XeroRateLimitError } from "@/integrations/xero";
import { ReadFailureNotice, toReadFailure, waitAdvice } from "./read-failure-view";

/**
 * The rendered HTML of a failed Xero read.
 *
 * Asserted in the markup rather than argued for in a comment, because the defect this guards
 * against was invisible in the code and obvious on screen: every `XeroApiError` rendered a
 * "Re-authorise" button, including a Xero-side 503, and three re-authorisations were spent on
 * a connection that was never broken.
 */

const render = (error: XeroApiError) =>
  renderToStaticMarkup(<ReadFailureNotice failure={toReadFailure(error)} />);

/** The only thing on screen that asks the user to fix their authorisation. */
const RECONSENT_MARKERS = ["Re-authorise", "/api/xero/connect"];

describe("a busy Xero", () => {
  const busy: Array<[string, XeroApiError]> = [
    [
      "503 gateway overflow",
      new XeroApiError(
        503,
        "/Organisation",
        "upstream connect error or disconnect/reset before headers. reset reason: overflow",
      ),
    ],
    ["429 day limit", new XeroRateLimitError("/Organisation", 60, "day")],
    ["500", new XeroApiError(500, "/Invoices", "internal error")],
    ["504", new XeroApiError(504, "/BankTransactions", "gateway timeout")],
  ];

  for (const [label, error] of busy) {
    it(`offers no re-authorisation for a ${label}`, () => {
      const html = render(error);
      for (const marker of RECONSENT_MARKERS) {
        expect(html).not.toContain(marker);
      }
      expect(html).toContain("Xero is busy");
    });
  }

  it("states the wait in seconds when Xero sent Retry-After", () => {
    expect(render(new XeroRateLimitError("/Organisation", 37, "day"))).toContain(
      "Try again in 37 seconds.",
    );
  });

  it("does not invent a wait when Xero sent none", () => {
    const html = render(new XeroApiError(503, "/Organisation", "overflow"));
    expect(html).toContain("Try again shortly.");
    expect(html).not.toContain("seconds");
  });

  it("never renders a zero-second wait", () => {
    // A missing Retry-After must not become "0 seconds", which reads as advice.
    for (const error of busy.map(([, e]) => e)) {
      expect(render(error)).not.toContain("in 0 seconds");
    }
  });

  it("still shows the underlying detail, so the cause is diagnosable", () => {
    expect(render(new XeroApiError(503, "/Organisation", "reset reason: overflow"))).toContain(
      "reset reason: overflow",
    );
  });
});

describe("a genuine authorisation failure", () => {
  const authErrors: Array<[number, string]> = [
    [401, "token expired"],
    [403, "forbidden"],
  ];

  for (const [status, detail] of authErrors) {
    it(`does offer re-authorisation for a ${status}`, () => {
      const html = render(new XeroApiError(status, "/Organisation", detail));
      for (const marker of RECONSENT_MARKERS) {
        expect(html).toContain(marker);
      }
      expect(html).toContain("Xero read failed");
      expect(html).not.toContain("Xero is busy");
    });
  }
});

describe("classification", () => {
  it("maps a 503 to BUSY and a 401 to AUTH", () => {
    expect(toReadFailure(new XeroApiError(503, "/x", "d")).kind).toBe("BUSY");
    expect(toReadFailure(new XeroApiError(401, "/x", "d")).kind).toBe("AUTH");
  });

  it("carries Retry-After through the mapping", () => {
    const failure = toReadFailure(new XeroRateLimitError("/x", 12, "minute"));
    expect(failure).toEqual({
      kind: "BUSY",
      detail: "Xero /x failed with 429: rate limit reached (minute)",
      retryAfterSeconds: 12,
    });
  });
});

describe("waitAdvice", () => {
  it("is explicit that nothing is known when Retry-After is absent", () => {
    expect(waitAdvice(null)).toBe("Xero is busy. Try again shortly.");
  });

  it("uses the number Xero gave, verbatim", () => {
    expect(waitAdvice(90)).toBe("Xero is busy. Try again in 90 seconds.");
  });
});
