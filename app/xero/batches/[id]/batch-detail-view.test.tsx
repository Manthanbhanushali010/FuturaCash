import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildBatchDetail } from "@/integrations/xero/batch-detail";
import type { XeroBatchPayment, XeroPayment } from "@/integrations/xero/schemas";
import { XeroApiError, XeroRateLimitError } from "@/integrations/xero/client";
import { toReadFailure } from "../../read-failure-view";
import { BatchDetailView, EM_DASH, type BatchDetailView as View } from "./batch-detail-view";

/**
 * The rendered markup for every state this page can reach.
 *
 * Synthetic fixtures throughout. `PAYEE` and `INVOICE_NUMBER` appear nowhere in real data, so
 * an assertion that they are absent cannot pass by accident.
 */
const BATCH_ID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";
const PAYEE = "Zzyzx Synthetic Supplies Ltd";
const INVOICE_NUMBER = "SYNTH-0001";

function payment(overrides: Partial<XeroPayment> = {}): XeroPayment {
  return {
    PaymentID: "p-1",
    BatchPaymentID: BATCH_ID,
    Date: "2026-03-01T00:00:00",
    Amount: 100,
    BankAmount: 100,
    Invoice: {
      InvoiceID: "i-1",
      InvoiceNumber: INVOICE_NUMBER,
      Contact: { ContactID: "c-1", Name: PAYEE },
    },
    ...overrides,
  } as XeroPayment;
}

function batch(overrides: Partial<XeroBatchPayment> = {}): XeroBatchPayment {
  return {
    BatchPaymentID: BATCH_ID,
    Type: "PAYBATCH",
    Status: "AUTHORISED",
    DateString: "2026-03-01T00:00:00",
    TotalAmount: 300,
    Account: { AccountID: "a-1", CurrencyCode: "GBP" },
    ...overrides,
  } as XeroBatchPayment;
}

function render(view: View): string {
  return renderToStaticMarkup(<BatchDetailView view={view} />);
}

function ready(
  b: XeroBatchPayment,
  payments: XeroPayment[],
  truncated = false,
): View {
  return {
    kind: "READY",
    detail: buildBatchDetail(b, payments, { fallbackCurrency: null, truncated }),
  };
}

/**
 * The em dash as a LITERAL, deliberately not via the imported constant.
 *
 * `expect(html).toContain(EM_DASH)` is trivially true if EM_DASH is ever emptied — found by
 * mutating it to "", which passed all 30 tests. A test for a visible marker has to name the
 * character it expects to see.
 */
const DASH = "\u2014";

/** Anchored to element boundaries. `toContain("0.00")` matches inside "300.00". */
function rendersBareZero(html: string): boolean {
  return /&gt;0\.00|>0\.00\s*[A-Z]{3}<|>0\.00</.test(html);
}

describe("the em dash constant", () => {
  it("IS an em dash, so every assertion below means what it says", () => {
    expect(EM_DASH).toBe(DASH);
    expect(EM_DASH).toHaveLength(1);
  });
});

describe("a batch that ties", () => {
  const html = render(
    ready(batch({ TotalAmount: 300 }), [
      payment({ PaymentID: "p-1", BankAmount: 100 }),
      payment({ PaymentID: "p-2", BankAmount: 200 }),
    ]),
  );

  it("shows the payee and invoice number", () => {
    expect(html).toContain(PAYEE);
    expect(html).toContain(INVOICE_NUMBER);
  });

  it("shows the footer total AND the batch total, and says they agree", () => {
    expect(html).toContain("300.00");
    expect(html).toContain("agree to the penny");
    expect(html).toContain("ties");
  });

  it("renders no bare zero anywhere", () => {
    expect(rendersBareZero(html)).toBe(false);
  });

  it("names the amount basis, so the column is not ambiguous", () => {
    expect(html).toContain("BankAmount");
  });

  it("offers no Re-authorise on a healthy read", () => {
    expect(html).not.toContain("Re-authorise");
    expect(html).not.toContain("/api/xero/connect");
  });
});

describe("missing values render as an em dash, never as a zero", () => {
  it("uses an em dash for an absent payee and invoice number", () => {
    const html = render(
      ready(batch({ TotalAmount: 100 }), [payment({ Invoice: undefined })]),
    );
    expect(html).toContain(DASH);
    expect(html).not.toContain(PAYEE);
    expect(rendersBareZero(html)).toBe(false);
  });

  it("uses an em dash for an absent date", () => {
    const html = render(
      ready(batch({ TotalAmount: 100 }), [payment({ Date: undefined })]),
    );
    expect(html).toContain(DASH);
  });

  it("uses an em dash for an absent amount, and does NOT print 0.00", () => {
    const html = render(
      ready(batch({ TotalAmount: 100 }), [payment({ BankAmount: undefined })]),
    );
    expect(html).toContain(DASH);
    expect(rendersBareZero(html)).toBe(false);
  });

  it("shows an em dash instead of a summed footer when the rows cannot be summed", () => {
    // The sum is 0 internally; printing it would be a figure standing for an unknown.
    const html = render(
      ready(batch({ TotalAmount: 300 }), [
        payment({ PaymentID: "p-1", BankAmount: 300 }),
        payment({ PaymentID: "p-2", BankAmount: undefined }),
      ]),
    );
    expect(html).toContain("could not be checked");
    expect(rendersBareZero(html)).toBe(false);
  });
});

describe("a mismatch is visible", () => {
  const html = render(ready(batch({ TotalAmount: 300 }), [payment({ BankAmount: 100 })]));

  it("says so in the heading and marks the footer", () => {
    expect(html).toContain("do not sum to the batch total");
    expect(html).toContain("check");
    expect(html).not.toContain("agree to the penny");
  });

  it("shows both figures unadjusted", () => {
    expect(html).toContain("100.00");
    expect(html).toContain("300.00");
  });
});

describe("a truncated read", () => {
  const html = render(
    ready(batch({ TotalAmount: 300 }), [payment({ BankAmount: 300 })], true),
  );

  it("marks the page as partial", () => {
    expect(html).toContain("only part of the batch");
    expect(html).toContain("page cap");
  });

  it("does NOT claim a tie even though the arithmetic agrees", () => {
    expect(html).not.toContain("agree to the penny");
    expect(html).toContain("could not be checked");
  });
});

describe("the filter-ignored state", () => {
  const html = render({
    kind: "FILTER_IGNORED",
    batchId: BATCH_ID,
    returned: 100,
    foreignRows: 64,
  });

  it("shows NO total at all", () => {
    expect(html).toContain("was not applied");
    expect(html).not.toContain("agree to the penny");
    // No money figure of any kind is rendered in this state.
    expect(html).not.toMatch(/\d+\.\d{2}/);
  });

  it("reports how many rows were foreign", () => {
    expect(html).toContain("64");
    expect(html).toContain("100");
  });

  it("does not offer Re-authorise — the grant is fine", () => {
    expect(html).not.toContain("Re-authorise");
  });
});

describe("busy and failure states follow PR #4", () => {
  it.each([429, 500, 502, 503, 504])("offers NO Re-authorise on %i", (status) => {
    const error =
      status === 429
        ? new XeroRateLimitError("/Payments", 30, "day")
        : new XeroApiError(status, "/Payments", "upstream", null);
    const html = render({ kind: "READ_FAILED", failure: toReadFailure(error) });
    expect(html).not.toContain("Re-authorise");
    expect(html).not.toContain("/api/xero/connect");
    expect(html).toContain("busy");
  });

  it("passes Retry-After through as a wait time", () => {
    const html = render({
      kind: "READ_FAILED",
      failure: toReadFailure(new XeroRateLimitError("/Payments", 30, "day")),
    });
    expect(html).toContain("30 seconds");
  });

  it.each([401, 403])("DOES offer Re-authorise on %i", (status) => {
    const html = render({
      kind: "READ_FAILED",
      failure: toReadFailure(new XeroApiError(status, "/Payments", "unauthorised", null)),
    });
    expect(html).toContain("Re-authorise");
  });

  it("shows no figures in any failure state", () => {
    const html = render({
      kind: "READ_FAILED",
      failure: toReadFailure(new XeroApiError(503, "/Payments", "upstream", null)),
    });
    expect(rendersBareZero(html)).toBe(false);
  });
});

describe("the remaining states", () => {
  it("rejects a malformed id without mentioning Xero having been called", () => {
    const html = render({ kind: "INVALID_ID" });
    expect(html).toContain("not a batch id");
    expect(html).toContain("no Xero call was made");
    expect(html).not.toContain("Re-authorise");
  });

  it("explains a missing scope without showing a zero", () => {
    const html = render({ kind: "SCOPE_MISSING" });
    expect(html).toContain("accounting.payments.read");
    expect(rendersBareZero(html)).toBe(false);
  });

  it("distinguishes a batch that does not exist from an empty one", () => {
    const html = render({ kind: "NOT_FOUND", batchId: BATCH_ID });
    expect(html).toContain("No such batch");
    expect(html).not.toMatch(/\d+\.\d{2}/);
  });

  it("does not offer Re-authorise for an unprojectable batch", () => {
    const html = render({ kind: "UNREADABLE", detail: "unsupported currency CNY" });
    expect(html).toContain("unsupported currency CNY");
    expect(html).not.toContain("Re-authorise");
  });

  it("every state links back to the Xero screen", () => {
    const states: View[] = [
      { kind: "INVALID_ID" },
      { kind: "SCOPE_MISSING" },
      { kind: "NOT_FOUND", batchId: BATCH_ID },
      { kind: "FILTER_IGNORED", batchId: BATCH_ID, returned: 1, foreignRows: 1 },
      { kind: "UNREADABLE", detail: "x" },
      ready(batch(), [payment({ BankAmount: 300 })]),
    ];
    for (const state of states) {
      expect(render(state)).toContain('href="/xero"');
    }
  });
});
