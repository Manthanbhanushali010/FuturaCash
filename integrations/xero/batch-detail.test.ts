import { describe, expect, it } from "vitest";
import { buildBatchDetail, foreignRowCount } from "./batch-detail";
import type { XeroBatchPayment, XeroPayment } from "./schemas";

/**
 * All fixtures synthetic. Names are deliberately recognisable as fake, and the amounts are
 * round so an arithmetic slip is obvious on sight.
 */
const BATCH_ID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";
const OTHER_BATCH_ID = "11112222-3333-4444-5555-666677778888";

function payment(overrides: Partial<XeroPayment> = {}): XeroPayment {
  return {
    PaymentID: "p-1",
    BatchPaymentID: BATCH_ID,
    Date: "2026-03-01T00:00:00",
    Amount: 100,
    BankAmount: 100,
    Invoice: {
      InvoiceID: "i-1",
      InvoiceNumber: "SYNTH-0001",
      Contact: { ContactID: "c-1", Name: "Aardvark Synthetic Ltd" },
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

const OPTS = { fallbackCurrency: null, truncated: false } as const;

describe("buildBatchDetail", () => {
  it("ties when the rows sum to the batch total", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 300 }),
      [
        payment({ PaymentID: "p-1", BankAmount: 100 }),
        payment({ PaymentID: "p-2", BankAmount: 200 }),
      ],
      OPTS,
    );
    expect(detail.memberCount).toBe(2);
    expect(detail.membersTotal.minor).toBe(30_000);
    expect(detail.batchTotal.minor).toBe(30_000);
    expect(detail.tie).toBe("TIES");
    expect(detail.tieReason).toBeNull();
  });

  it("reports MISMATCH without adjusting either figure", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 300 }),
      [payment({ BankAmount: 100 })],
      OPTS,
    );
    expect(detail.tie).toBe("MISMATCH");
    expect(detail.membersTotal.minor).toBe(10_000);
    expect(detail.batchTotal.minor).toBe(30_000);
    expect(detail.tieReason).toContain("do not sum");
  });

  it("is UNCHECKABLE when truncated, EVEN IF the arithmetic happens to agree", () => {
    // The order of these checks is the point: a partial read that coincidentally sums to the
    // total is still a partial read, and calling it a tie would be a false reassurance.
    const detail = buildBatchDetail(
      batch({ TotalAmount: 300 }),
      [payment({ PaymentID: "p-1", BankAmount: 300 })],
      { fallbackCurrency: null, truncated: true },
    );
    expect(detail.tie).toBe("UNCHECKABLE");
    expect(detail.truncated).toBe(true);
    expect(detail.tieReason).toContain("page cap");
  });

  it("is UNCHECKABLE when a row has no BankAmount, rather than summing what is there", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 300 }),
      [
        payment({ PaymentID: "p-1", BankAmount: 300 }),
        payment({ PaymentID: "p-2", BankAmount: undefined }),
      ],
      OPTS,
    );
    expect(detail.tie).toBe("UNCHECKABLE");
    expect(detail.tieReason).toContain("BankAmount");
    // Partial sums are not published: 300 of an unknown total reads as a complete figure.
    expect(detail.membersTotal.minor).toBe(0);
    expect(detail.members.find((m) => m.paymentId === "p-2")!.amount).toBeNull();
  });

  it("sums BankAmount, not Amount — they diverge under a currency rate", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 150 }),
      [payment({ Amount: 100, BankAmount: 150, CurrencyRate: 1.5 })],
      OPTS,
    );
    expect(detail.tie).toBe("TIES");
    expect(detail.membersTotal.minor).toBe(15_000);
  });

  it("sorts by amount descending", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 600 }),
      [
        payment({ PaymentID: "p-1", BankAmount: 100 }),
        payment({ PaymentID: "p-2", BankAmount: 300 }),
        payment({ PaymentID: "p-3", BankAmount: 200 }),
      ],
      OPTS,
    );
    expect(detail.members.map((m) => m.amount!.minor)).toEqual([30_000, 20_000, 10_000]);
  });

  it("breaks an amount tie by payee, ascending", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 300 }),
      [
        named("p-1", "Zebra Synthetic Ltd", 100),
        named("p-2", "Aardvark Synthetic Ltd", 100),
        named("p-3", "Marmot Synthetic Ltd", 100),
      ],
      OPTS,
    );
    expect(detail.members.map((m) => m.payee)).toEqual([
      "Aardvark Synthetic Ltd",
      "Marmot Synthetic Ltd",
      "Zebra Synthetic Ltd",
    ]);
  });

  it("sorts a row with no amount last, and an unnamed payee after named ones", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 300 }),
      [
        payment({ PaymentID: "p-1", BankAmount: undefined }),
        named("p-2", "Aardvark Synthetic Ltd", 100),
      ],
      OPTS,
    );
    expect(detail.members[0]!.paymentId).toBe("p-2");
    expect(detail.members[1]!.paymentId).toBe("p-1");

    const unnamed = buildBatchDetail(
      batch({ TotalAmount: 200 }),
      [named("p-1", null, 100), named("p-2", "Aardvark Synthetic Ltd", 100)],
      OPTS,
    );
    expect(unnamed.members.map((m) => m.payee)).toEqual(["Aardvark Synthetic Ltd", null]);
  });

  it("treats a missing payee or invoice number as null, for an em dash", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 100 }),
      [payment({ Invoice: undefined })],
      OPTS,
    );
    expect(detail.members[0]!.payee).toBeNull();
    expect(detail.members[0]!.invoiceNumber).toBeNull();
  });

  it("treats an EMPTY or whitespace payee as null, not as a value", () => {
    // An empty cell reads as a value. `Reference` is live-but-empty on every row, which is
    // exactly why it is not a column; the same trap applies to any string field.
    const detail = buildBatchDetail(
      batch({ TotalAmount: 200 }),
      [
        payment({
          PaymentID: "p-1",
          BankAmount: 100,
          Invoice: { InvoiceID: "i", InvoiceNumber: "   ", Contact: { ContactID: "c", Name: "" } },
        }),
        payment({ PaymentID: "p-2", BankAmount: 100 }),
      ],
      OPTS,
    );
    const blank = detail.members.find((m) => m.paymentId === "p-1")!;
    expect(blank.payee).toBeNull();
    expect(blank.invoiceNumber).toBeNull();
  });

  it("takes the currency from the bank account, not the org", () => {
    const detail = buildBatchDetail(
      batch({ Account: { AccountID: "a", CurrencyCode: "USD" }, TotalAmount: 100 }),
      [payment({ BankAmount: 100 })],
      { fallbackCurrency: "GBP", truncated: false },
    );
    expect(detail.currency).toBe("USD");
    expect(detail.batchTotal.currency).toBe("USD");
  });

  it("uses the fallback currency only when the account has none", () => {
    const detail = buildBatchDetail(
      batch({ Account: { AccountID: "a" }, TotalAmount: 100 }),
      [payment({ BankAmount: 100 })],
      { fallbackCurrency: "EUR", truncated: false },
    );
    expect(detail.currency).toBe("EUR");
  });

  it("throws rather than guessing when no currency is available at all", () => {
    expect(() =>
      buildBatchDetail(batch({ Account: undefined }), [payment()], OPTS),
    ).toThrow(/CurrencyCode/);
  });

  it("throws rather than becoming zero when the batch has no total", () => {
    // toMoney(undefined) returns zero, which is how all 1,421 batches once summed to nothing.
    expect(() =>
      buildBatchDetail(batch({ TotalAmount: undefined, Amount: undefined }), [payment()], OPTS),
    ).toThrow(/TotalAmount/);
  });

  it("prefers TotalAmount over Amount", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 100, Amount: 999 }),
      [payment({ BankAmount: 100 })],
      OPTS,
    );
    expect(detail.batchTotal.minor).toBe(10_000);
  });

  it("handles a batch with no payments without inventing a figure", () => {
    const detail = buildBatchDetail(batch({ TotalAmount: 300 }), [], OPTS);
    expect(detail.memberCount).toBe(0);
    expect(detail.members).toEqual([]);
    // Zero rows against a non-zero total is a mismatch, not a tie.
    expect(detail.tie).toBe("MISMATCH");
  });

  it("handles a 200-member batch", () => {
    const members = Array.from({ length: 200 }, (_, i) =>
      payment({ PaymentID: `p-${i}`, BankAmount: 1 }),
    );
    const detail = buildBatchDetail(batch({ TotalAmount: 200 }), members, OPTS);
    expect(detail.memberCount).toBe(200);
    expect(detail.tie).toBe("TIES");
  });

  it("carries the batch's own metadata through", () => {
    const detail = buildBatchDetail(
      batch({ Type: "RECBATCH", Status: "DELETED", TotalAmount: 100 }),
      [payment({ BankAmount: 100 })],
      OPTS,
    );
    expect(detail.batchExternalId).toBe(BATCH_ID);
    expect(detail.providerType).toBe("RECBATCH");
    expect(detail.providerStatus).toBe("DELETED");
    expect(detail.batchDate).toContain("2026-03-01");
  });

  it("reports a missing date as null rather than today", () => {
    const detail = buildBatchDetail(
      batch({ TotalAmount: 100 }),
      [payment({ Date: undefined, BankAmount: 100 })],
      OPTS,
    );
    expect(detail.members[0]!.paidAt).toBeNull();
  });
});

describe("foreignRowCount", () => {
  it("is zero when every row carries the requested batch id", () => {
    expect(foreignRowCount([payment(), payment({ PaymentID: "p-2" })], BATCH_ID)).toBe(0);
  });

  it("counts rows belonging to another batch", () => {
    expect(
      foreignRowCount(
        [payment(), payment({ PaymentID: "p-2", BatchPaymentID: OTHER_BATCH_ID })],
        BATCH_ID,
      ),
    ).toBe(1);
  });

  it("counts a row with NO batch id as foreign", () => {
    // An unbatched payment in a batch-filtered read means the filter was not applied.
    expect(foreignRowCount([payment({ BatchPaymentID: undefined })], BATCH_ID)).toBe(1);
  });

  it("compares case-insensitively, since Xero returns GUIDs in either case", () => {
    expect(foreignRowCount([payment({ BatchPaymentID: BATCH_ID.toUpperCase() })], BATCH_ID)).toBe(
      0,
    );
  });
});

function named(id: string, payee: string | null, amount: number): XeroPayment {
  return payment({
    PaymentID: id,
    BankAmount: amount,
    Invoice: {
      InvoiceID: `i-${id}`,
      InvoiceNumber: `SYNTH-${id}`,
      ...(payee === null ? {} : { Contact: { ContactID: `c-${id}`, Name: payee } }),
    },
  });
}
