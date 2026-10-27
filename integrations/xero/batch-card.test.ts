import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBatchPaymentCard } from "./batch-card";
import type { XeroBatchPayment } from "./schemas";

/**
 * The batch-payments card.
 *
 * Shapes are the live ones surveyed on 2026-10-27: a batch carries `TotalAmount` (never
 * `Amount`), its currency only via `Account.CurrencyCode`, and nested members carrying
 * `PaymentID`, `Amount` and `BankAmount` but no status, type or date.
 */

function batch(overrides: Partial<XeroBatchPayment> = {}): XeroBatchPayment {
  return {
    BatchPaymentID: "batch-1",
    Type: "PAYBATCH",
    Status: "AUTHORISED",
    Date: "/Date(1792972800000+0000)/",
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

const GBP = { fallbackCurrency: "GBP" } as const;

describe("buildBatchPaymentCard — the must-be-empty integrity bucket", () => {
  it("is empty when every batch total equals its nested members", () => {
    const card = buildBatchPaymentCard([batch()], GBP);

    expect(card.integrityBucket).toEqual([]);
    expect(card.rows[0]?.tie).toBe("TIES");
    expect(card.rows[0]?.memberCount).toBe(2);
    expect(card.rows[0]?.memberTotal.minor).toBe(30_000);
  });

  it("catches a doctored batch whose total exceeds its members", () => {
    // One penny is enough. This is the whole reason the bucket exists: a batch total that
    // does not match its own members is wrong by a small, plausible amount, and nothing in
    // the payload errors.
    const card = buildBatchPaymentCard([batch({ TotalAmount: 300.01 })], GBP);

    expect(card.integrityBucket).toHaveLength(1);
    expect(card.integrityBucket[0]?.tie).toBe("MISMATCH");
    expect(card.integrityBucket[0]?.tieReason).toContain("30001");
    expect(card.integrityBucket[0]?.tieReason).toContain("30000");
  });

  it("catches a doctored batch whose members exceed its total", () => {
    const card = buildBatchPaymentCard(
      [
        batch({
          Payments: [
            { PaymentID: "p-1", Amount: 100, BankAmount: 100 },
            { PaymentID: "p-2", Amount: 200, BankAmount: 200 },
            { PaymentID: "p-3", Amount: 50, BankAmount: 50 },
          ],
        }),
      ],
      GBP,
    );

    expect(card.integrityBucket).toHaveLength(1);
    expect(card.integrityBucket[0]?.memberCount).toBe(3);
  });

  it("catches a batch that lost its members entirely", () => {
    // The shape a silent nested-member cap would take. Two live batches hold exactly 200
    // members, so this is not hypothetical.
    const card = buildBatchPaymentCard([batch({ Payments: [] })], GBP);

    expect(card.integrityBucket).toHaveLength(1);
    expect(card.rows[0]?.memberCount).toBe(0);
  });

  it("sums the members' BankAmount, not their Amount, when a currency rate makes them differ", () => {
    // The two are equal on every live member today, so only a constructed rate separates
    // them — and without this the basis is unpinned: swapping the sum to `Amount` broke no
    // test. `Amount` is in the invoice's currency, `BankAmount` in the bank account's, and
    // the batch total is quoted in the bank account's. Summing `Amount` would report a
    // mismatch on a perfectly consistent batch.
    const card = buildBatchPaymentCard(
      [
        batch({
          TotalAmount: 300,
          Payments: [{ PaymentID: "p-1", Amount: 400, BankAmount: 300 }],
        }),
      ],
      GBP,
    );

    expect(card.rows[0]?.tie).toBe("TIES");
    expect(card.rows[0]?.memberTotal.minor).toBe(30_000);
    expect(card.integrityBucket).toEqual([]);
  });

  it("refuses to compare when a member has no BankAmount, rather than falling back to Amount", () => {
    // `Amount` is in the invoice's currency and the total is in the bank account's. Summing
    // Amount would silently compare two currencies and call the result a tie or a mismatch
    // at random. Unverifiable still lands in the must-be-empty bucket.
    const card = buildBatchPaymentCard(
      [batch({ Payments: [{ PaymentID: "p-1", Amount: 300 }] })],
      GBP,
    );

    expect(card.integrityBucket).toHaveLength(1);
    expect(card.integrityBucket[0]?.tie).toBe("UNCHECKABLE");
    expect(card.integrityBucket[0]?.tieReason).toContain("BankAmount");
  });
});

describe("buildBatchPaymentCard — currencies stay separate", () => {
  it("subtotals per currency and never across them", () => {
    const card = buildBatchPaymentCard(
      [
        batch({ BatchPaymentID: "gbp-1", TotalAmount: 300 }),
        batch({
          BatchPaymentID: "usd-1",
          TotalAmount: 300,
          Account: { AccountID: "acct-2", CurrencyCode: "USD" },
        }),
      ],
      GBP,
    );

    expect(card.subtotals.map((s) => s.currency)).toEqual(["GBP", "USD"]);
    expect(card.subtotals.map((s) => s.outflow.minor)).toEqual([30_000, 30_000]);
    // No field anywhere holds a cross-currency figure.
    expect(card.subtotals).toHaveLength(2);
  });

  it("takes a batch's currency from its bank account, not the org base currency", () => {
    const card = buildBatchPaymentCard(
      [batch({ Account: { AccountID: "acct-2", CurrencyCode: "USD" } })],
      GBP,
    );

    expect(card.rows[0]?.total.currency).toBe("USD");
  });

  it("uses the org base currency only when the bank account omits one", () => {
    const card = buildBatchPaymentCard([batch({ Account: { AccountID: "acct-3" } })], GBP);

    expect(card.rows[0]?.total.currency).toBe("GBP");
  });

  it("reports a failure rather than guessing when neither currency is known", () => {
    const card = buildBatchPaymentCard([batch({ Account: undefined })], {
      fallbackCurrency: null,
    });

    expect(card.rows).toEqual([]);
    expect(card.failures).toHaveLength(1);
    expect(card.failures[0]?.reason).toContain("base currency is unknown");
  });

  it("separates directions as well as currencies", () => {
    const card = buildBatchPaymentCard(
      [
        batch({ BatchPaymentID: "out-1", Type: "PAYBATCH", TotalAmount: 300 }),
        batch({ BatchPaymentID: "in-1", Type: "RECBATCH", TotalAmount: 50 }),
      ],
      GBP,
    );

    const gbp = card.subtotals[0];
    expect(gbp?.outflow.minor).toBe(30_000);
    expect(gbp?.inflow.minor).toBe(5_000);
    expect(gbp?.outflowCount).toBe(1);
    expect(gbp?.inflowCount).toBe(1);
  });
});

describe("buildBatchPaymentCard — the card contributes to no cash figure", () => {
  it("exposes no total that crosses currencies or directions", () => {
    const card = buildBatchPaymentCard([batch()], GBP);

    // Every monetary field reachable from the card is either on a single row or inside a
    // per-currency, per-direction subtotal. A regression that added `total` or `net` at the
    // top level — the shape that could be mistaken for cash movement — fails here.
    expect(Object.keys(card).sort()).toEqual([
      "failures",
      "futureDated",
      "integrityBucket",
      "rows",
      "subtotals",
    ]);
    for (const subtotal of card.subtotals) {
      expect(Object.keys(subtotal).sort()).toEqual([
        "currency",
        "inflow",
        "inflowCount",
        "outflow",
        "outflowCount",
      ]);
    }
  });

  it("is not referenced by the reconciliation, in either direction", () => {
    // The strongest available guard against the double-count: batch totals are already
    // inside the bank-transaction read, so wiring this module into `reconcile` would add
    // real money twice. A source-level check fails the day someone imports it.
    const reconcile = readFileSync(new URL("./reconcile.ts", import.meta.url), "utf8");
    expect(reconcile).not.toContain("batch-card");
    expect(reconcile).not.toContain("buildBatchPaymentCard");

    const card = readFileSync(new URL("./batch-card.ts", import.meta.url), "utf8");
    expect(card).not.toContain("./reconcile");

    // Matched on the import and the call, not the bare word: the page legitimately says
    // "reconciled" on a bank transaction, and a substring check on "reconcile" would pass or
    // fail for the wrong reason.
    const page = readFileSync(new URL("../../app/xero/page.tsx", import.meta.url), "utf8");
    expect(page).not.toContain("xero/reconcile");
    expect(page).not.toContain("reconcile(");
  });
});

describe("buildBatchPaymentCard — bounds and gaps are stated", () => {
  it("counts future-dated batches instead of hiding them", () => {
    const card = buildBatchPaymentCard(
      [
        batch({ BatchPaymentID: "past", DateString: "2026-10-20T00:00:00" }),
        batch({ BatchPaymentID: "future", DateString: "2026-11-02T00:00:00" }),
      ],
      { ...GBP, now: new Date("2026-10-27T12:00:00Z") },
    );

    expect(card.futureDated).toBe(1);
    // Still listed and still subtotalled — counted, not filtered.
    expect(card.rows).toHaveLength(2);
  });

  it("reports a batch with neither TotalAmount nor Amount instead of treating it as zero", () => {
    // `toMoney(undefined)` returns zero, which is how 1,421 batches once became £0.00 in
    // total silence. A missing total has to be fatal for the record.
    const card = buildBatchPaymentCard([batch({ TotalAmount: undefined })], GBP);

    expect(card.rows).toEqual([]);
    expect(card.failures[0]?.reason).toContain("neither TotalAmount nor Amount");
  });

  it("falls back to Amount when TotalAmount is absent but Amount is sent", () => {
    const card = buildBatchPaymentCard(
      [batch({ TotalAmount: undefined, Amount: 300 })],
      GBP,
    );

    expect(card.rows[0]?.total.minor).toBe(30_000);
  });

  it("reports an unrecognised batch type rather than putting it on a side", () => {
    const card = buildBatchPaymentCard([batch({ Type: "SOMETHINGNEW" })], GBP);

    expect(card.rows).toEqual([]);
    expect(card.failures[0]?.reason).toContain("SOMETHINGNEW");
  });

  it("keeps good batches when one in the set fails", () => {
    const card = buildBatchPaymentCard(
      [batch({ BatchPaymentID: "ok" }), batch({ BatchPaymentID: "bad", Type: "NOPE" })],
      GBP,
    );

    expect(card.rows).toHaveLength(1);
    expect(card.failures).toHaveLength(1);
    expect(card.subtotals[0]?.outflow.minor).toBe(30_000);
  });
});
