import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildBatchPaymentCard,
  type BatchPaymentCard,
} from "@/integrations/xero/batch-card";
import type { XeroBatchPayment } from "@/integrations/xero/schemas";
import {
  BatchPaymentsView,
  PAID_LABEL,
  SCHEDULED_LABEL,
  type BatchPaymentsView as View,
} from "./batch-payments-view";

/**
 * What the Batch payments card actually renders.
 *
 * These are the assertions the project has been unable to make until now: every failure state
 * on `/xero` was previously verified by loading production by hand, which does not survive a
 * refactor. The rule under test is the one most easily broken by a well-meaning change —
 * **never render a zero in place of an error** — so it is asserted against the HTML rather
 * than against an intermediate object.
 */

const NOW = new Date("2026-10-27T12:00:00Z");

function batch(overrides: Partial<XeroBatchPayment> = {}): XeroBatchPayment {
  return {
    BatchPaymentID: "batch-1",
    Type: "PAYBATCH",
    Status: "AUTHORISED",
    DateString: "2026-10-25T00:00:00",
    TotalAmount: 300,
    Account: { AccountID: "acct-1", CurrencyCode: "GBP" },
    Payments: [
      { PaymentID: "p-1", Amount: 100, BankAmount: 100 },
      { PaymentID: "p-2", Amount: 200, BankAmount: 200 },
    ],
    ...overrides,
  } as XeroBatchPayment;
}

function card(batches: readonly XeroBatchPayment[]): BatchPaymentCard {
  return buildBatchPaymentCard(batches, { fallbackCurrency: "GBP", now: NOW });
}

function render(view: View): string {
  return renderToStaticMarkup(<BatchPaymentsView view={view} />);
}

function ready(batches: readonly XeroBatchPayment[]): string {
  return render({
    kind: "READY",
    card: card(batches),
    windowSince: "2026-09-27",
    windowDays: 30,
  });
}

/** Any rendered money figure, e.g. "0.00 GBP" or "706,760.52 GBP". */
const ANY_FIGURE = /[\d,]+\.\d\d\s*[A-Z]{3}/;

/**
 * A rendered ZERO figure, anchored to the element boundaries.
 *
 * A plain `toContain("0.00 GBP")` matches inside "300.00 GBP", so it fires on a card with no
 * zeros anywhere. Every figure is wrapped in its own span, so the `>` and `<` make the match
 * the whole value rather than its tail.
 */
const ZERO_FIGURE = />0\.00\s*[A-Z]{3}</;

describe("never a zero in place of an error", () => {
  it("renders no monetary figure at all when the read failed", () => {
    const html = render({ kind: "FAILED", detail: "429 Too Many Requests" });

    expect(html).toContain("could not be read");
    expect(html).toContain("429 Too Many Requests");
    expect(html).not.toMatch(ANY_FIGURE);
    // Not merely "no 0.00" — no subtotal grid and no table at all.
    expect(html).not.toContain("<table");
    expect(html).not.toContain(PAID_LABEL);
  });

  it("renders no monetary figure at all when the read was truncated", () => {
    const html = render({ kind: "TRUNCATED" });

    expect(html).toContain("cut short");
    expect(html).not.toMatch(ANY_FIGURE);
    expect(html).not.toContain("<table");
  });

  it("renders no monetary figure at all when the scope is missing", () => {
    const html = render({ kind: "SCOPE_MISSING" });

    expect(html).toContain("accounting.payments.read");
    expect(html).toContain("different facts");
    expect(html).not.toMatch(ANY_FIGURE);
    expect(html).not.toContain("<table");
  });

  it("does not claim a batch is already in bank transactions when nothing was read", () => {
    // The label is a claim about data. With no data it would be a claim about nothing.
    for (const view of [
      { kind: "FAILED", detail: "boom" },
      { kind: "TRUNCATED" },
      { kind: "SCOPE_MISSING" },
    ] satisfies View[]) {
      expect(render(view)).not.toContain(PAID_LABEL);
    }
  });
});

describe("paid and scheduled are separate claims", () => {
  it("puts a future-dated batch under Scheduled, not in the paid subtotals", () => {
    const html = ready([
      batch({ BatchPaymentID: "paid", DateString: "2026-10-20T00:00:00", TotalAmount: 300 }),
      batch({
        BatchPaymentID: "sched",
        DateString: "2026-11-02T00:00:00",
        TotalAmount: 1000,
        Payments: [{ PaymentID: "s-1", Amount: 1000, BankAmount: 1000 }],
      }),
    ]);

    expect(html).toContain("Scheduled");
    expect(html).toContain(SCHEDULED_LABEL);
    // The paid subtotal is the paid batch alone; the scheduled 1,000.00 is its own figure.
    expect(html).toContain("300.00 GBP");
    expect(html).toContain("1,000.00 GBP");
    expect(html).not.toContain("1,300.00 GBP");
  });

  it("applies the 'already included' label only to the paid section", () => {
    const html = ready([
      batch({ BatchPaymentID: "paid", DateString: "2026-10-20T00:00:00" }),
      batch({
        BatchPaymentID: "sched",
        DateString: "2026-11-02T00:00:00",
        Payments: [{ PaymentID: "s-1", Amount: 300, BankAmount: 300 }],
      }),
    ]);

    // One occurrence each: the paid label cannot leak onto the scheduled section.
    expect(html.split(PAID_LABEL)).toHaveLength(2);
    expect(html.split(SCHEDULED_LABEL)).toHaveLength(2);
  });

  it("omits the Scheduled section entirely when nothing is scheduled", () => {
    const html = ready([batch()]);

    expect(html).toContain(PAID_LABEL);
    expect(html).not.toContain(SCHEDULED_LABEL);
  });

  it("still says the paid section is empty when every batch is scheduled", () => {
    // The dangerous case: an empty paid section must read as empty, not as zero.
    const html = ready([
      batch({ DateString: "2026-11-02T00:00:00", TotalAmount: 300 }),
    ]);

    expect(html).toContain("No paid AUTHORISED batch payments");
    expect(html).toContain(SCHEDULED_LABEL);
    expect(html).not.toMatch(ZERO_FIGURE);
  });
});

describe("the integrity bucket is visible either way", () => {
  it("states zero when every batch ties", () => {
    const html = ready([batch()]);

    expect(html).toContain("batches disagree with the payments");
    expect(html).toContain(">0<");
  });

  it("renders the mismatch, with the amounts that disagree", () => {
    const html = ready([batch({ TotalAmount: 300.01 })]);

    expect(html).toContain("do not equal the sum of their nested payments");
    expect(html).toContain("30001");
    expect(html).toContain("30000");
    expect(html).toContain("expected to be empty");
  });

  it("renders an unsummable batch as a bucket entry too", () => {
    const html = ready([batch({ Payments: [{ PaymentID: "p-1", Amount: 300 }] })]);

    expect(html).toContain("BankAmount");
    expect(html).toContain("do not equal the sum of their nested payments");
  });

  it("marks a scheduled batch in the bucket as scheduled", () => {
    const html = ready([
      batch({ DateString: "2026-11-02T00:00:00", TotalAmount: 300.01 }),
    ]);

    expect(html).toContain("(scheduled)");
  });

  it("reports a failed batch rather than dropping it from the card", () => {
    const html = ready([batch({ Type: "SOMETHINGNEW" })]);

    expect(html).toContain("could not be read");
    expect(html).toContain("SOMETHINGNEW");
    expect(html).toContain("reported rather than dropped");
  });
});

describe("the exactly-200 member flag", () => {
  const twoHundred = batch({
    TotalAmount: 200,
    Payments: Array.from({ length: 200 }, (_, i) => ({
      PaymentID: `p-${i}`,
      Amount: 1,
      BankAmount: 1,
    })),
  }) as XeroBatchPayment;

  it("is shown when a batch holds exactly 200 payments", () => {
    const html = ready([twoHundred]);

    expect(html).toContain("hold exactly 200 payments");
    expect(html).toContain("member cap");
    expect(html).toContain("exactly 200");
  });

  it("does not claim the batch is wrong — it ties, and says so", () => {
    const html = ready([twoHundred]);

    expect(html).toContain("batches disagree with the payments");
    expect(html).toContain("confirmed genuine by reading them individually");
  });

  it("is absent at 199 payments", () => {
    const html = ready([
      batch({
        TotalAmount: 199,
        Payments: Array.from({ length: 199 }, (_, i) => ({
          PaymentID: `p-${i}`,
          Amount: 1,
          BankAmount: 1,
        })),
      }),
    ]);

    expect(html).not.toContain("hold exactly 200 payments");
  });
});

describe("currencies stay separate on screen, not just in the model", () => {
  it("renders a figure per currency and no combined one", () => {
    const html = ready([
      batch({ BatchPaymentID: "gbp", TotalAmount: 300 }),
      batch({
        BatchPaymentID: "usd",
        TotalAmount: 300,
        Account: { AccountID: "a2", CurrencyCode: "USD" },
      }),
    ]);

    expect(html).toContain("300.00 GBP");
    expect(html).toContain("300.00 USD");
    expect(html).not.toContain("600.00");
    expect(html).toContain("never summed across either");
  });
});
