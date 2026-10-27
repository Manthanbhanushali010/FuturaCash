import { describe, expect, it } from "vitest";
import {
  normaliseBatchPayment,
  normaliseBatchPayments,
  normalisePayment,
  normalisePayments,
  normaliseUnallocatedCredit,
  normaliseUnallocatedCredits,
} from "./normalise";
import type { XeroBatchPayment, XeroPayment, XeroUnallocatedCredit } from "./schemas";

/**
 * The payment family.
 *
 * Originally written from Xero's documented fields, because the grant did not yet hold
 * `accounting.payments.read` and all four endpoints returned 401. JENKI's connection was
 * re-authorised on 2026-10-22 and all four surveyed live; the assertions below the
 * "corrected by the live survey" heading replace documentation with measurement, and each one
 * pins a defect the documentation-based version actually had.
 */

const options = { fallbackCurrency: "GBP" as const };

describe("payment direction", () => {
  it("maps ACCREC* to INFLOW — a customer settling our invoice", () => {
    for (const t of ["ACCRECPAYMENT", "ACCRECCREDIT", "ACCRECPREPAYMENT", "ACCRECOVERPAYMENT"]) {
      const out = normalisePayment({ PaymentID: "p", PaymentType: t, Amount: 1 } as XeroPayment, options);
      expect(out.direction).toBe("INFLOW");
    }
  });

  it("maps ACCPAY* to OUTFLOW — us settling a bill", () => {
    for (const t of ["ACCPAYPAYMENT", "ACCPAYCREDIT", "ACCPAYPREPAYMENT", "ACCPAYOVERPAYMENT"]) {
      const out = normalisePayment({ PaymentID: "p", PaymentType: t, Amount: 1 } as XeroPayment, options);
      expect(out.direction).toBe("OUTFLOW");
    }
  });

  it("maps the batch types", () => {
    expect(normaliseBatchPayment({ BatchPaymentID: "b", Type: "RECBATCH", Amount: 1 } as XeroBatchPayment, options).direction).toBe("INFLOW");
    expect(normaliseBatchPayment({ BatchPaymentID: "b", Type: "PAYBATCH", Amount: 1 } as XeroBatchPayment, options).direction).toBe("OUTFLOW");
  });

  it("throws on an unrecognised type rather than guessing", () => {
    // A guessed direction flips cash in the forecast — same rule as invoices and bank txns.
    expect(() =>
      normalisePayment({ PaymentID: "p", PaymentType: "MYSTERY", Amount: 1 } as XeroPayment, options),
    ).toThrow(/Unrecognised Xero payment type/);
  });

  it("throws on a missing type rather than defaulting to a direction", () => {
    expect(() => normalisePayment({ PaymentID: "p", Amount: 1 } as XeroPayment, options)).toThrow();
  });
});

describe("source tagging", () => {
  it("records which endpoint each record came from", () => {
    expect(normalisePayment({ PaymentID: "p", PaymentType: "ACCRECPAYMENT", Amount: 1 } as XeroPayment, options).source).toBe("PAYMENT");
    expect(normaliseBatchPayment({ BatchPaymentID: "b", Type: "PAYBATCH", Amount: 1 } as XeroBatchPayment, options).source).toBe("BATCH_PAYMENT");
    expect(normaliseUnallocatedCredit({ PrepaymentID: "x", Type: "ACCRECPREPAYMENT", Total: 1 } as XeroUnallocatedCredit, "PREPAYMENT", options).source).toBe("PREPAYMENT");
    expect(normaliseUnallocatedCredit({ OverpaymentID: "y", Type: "ACCRECOVERPAYMENT", Total: 1 } as XeroUnallocatedCredit, "OVERPAYMENT", options).source).toBe("OVERPAYMENT");
  });
});

describe("money", () => {
  it("converts to exact integer minor units", () => {
    const out = normalisePayment({ PaymentID: "p", PaymentType: "ACCRECPAYMENT", Amount: 1240.5 } as XeroPayment, options);
    expect(out.amount.minor).toBe(124050);
    expect(Number.isInteger(out.amount.minor)).toBe(true);
  });

  it("refuses extra precision rather than rounding it away", () => {
    expect(() =>
      normalisePayment({ PaymentID: "p", PaymentType: "ACCRECPAYMENT", Amount: 1.005 } as XeroPayment, options),
    ).toThrow(/more precision than 2 minor-unit digit/);
  });

  it("carries RemainingCredit for unallocated credits — the cash-relevant figure", () => {
    // Real money in the bank with nothing matched against it yet.
    const out = normaliseUnallocatedCredit(
      { PrepaymentID: "x", Type: "ACCRECPREPAYMENT", Total: 500, RemainingCredit: 120.25, CurrencyCode: "GBP" } as XeroUnallocatedCredit,
      "PREPAYMENT",
      options,
    );
    expect(out.amount.minor).toBe(50000);
    expect(out.remainingCredit.minor).toBe(12025);
  });

  it("leaves remainingCredit at zero for payments, which are applied by definition", () => {
    const out = normalisePayment({ PaymentID: "p", PaymentType: "ACCPAYPAYMENT", Amount: 10 } as XeroPayment, options);
    expect(out.remainingCredit.minor).toBe(0);
  });

  it("honours a per-record currency on credits, falling back to the org base", () => {
    const eur = normaliseUnallocatedCredit({ PrepaymentID: "x", Type: "ACCRECPREPAYMENT", Total: 1, CurrencyCode: "EUR" } as XeroUnallocatedCredit, "PREPAYMENT", options);
    expect(eur.amount.currency).toBe("EUR");
    const fallback = normaliseUnallocatedCredit({ PrepaymentID: "y", Type: "ACCRECPREPAYMENT", Total: 1 } as XeroUnallocatedCredit, "PREPAYMENT", options);
    expect(fallback.amount.currency).toBe("GBP");
  });
});

describe("batch narrative", () => {
  it("takes the first non-empty of Reference, Narrative, Particulars, Details", () => {
    // Xero populates these inconsistently. Which one JENKI actually uses is a survey question.
    const out = normaliseBatchPayment(
      { BatchPaymentID: "b", Type: "PAYBATCH", Amount: 1, Reference: "   ", Narrative: "Supplier run 14 Oct" } as XeroBatchPayment,
      options,
    );
    expect(out.reference).toBe("Supplier run 14 Oct");
  });

  it("is null when every narrative field is blank", () => {
    const out = normaliseBatchPayment({ BatchPaymentID: "b", Type: "PAYBATCH", Amount: 1 } as XeroBatchPayment, options);
    expect(out.reference).toBeNull();
  });
});

describe("batches collect failures rather than dropping them", () => {
  it("keeps the good and reports the bad, per source", () => {
    const result = normalisePayments(
      [
        { PaymentID: "ok", PaymentType: "ACCRECPAYMENT", Amount: 1 },
        { PaymentID: "bad", PaymentType: "NONSENSE", Amount: 1 },
      ] as XeroPayment[],
      options,
    );
    expect(result.items).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.externalId).toBe("bad");
  });

  it("works for batches and credits too", () => {
    expect(normaliseBatchPayments([{ BatchPaymentID: "b", Type: "PAYBATCH", Amount: 1 }] as XeroBatchPayment[], options).items).toHaveLength(1);
    expect(normaliseUnallocatedCredits([{ PrepaymentID: "x", Type: "ACCRECPREPAYMENT", Total: 1 }] as XeroUnallocatedCredit[], "PREPAYMENT", options).items).toHaveLength(1);
  });

  it("reports a credit missing both ids rather than inventing one", () => {
    const result = normaliseUnallocatedCredits(
      [{ Type: "ACCRECPREPAYMENT", Total: 1 }] as XeroUnallocatedCredit[],
      "PREPAYMENT",
      options,
    );
    expect(result.items).toHaveLength(0);
    expect(result.failures[0]?.reason).toMatch(/missing both PrepaymentID and OverpaymentID/);
  });
});

// ===========================================================================================
// Corrected by the live survey (2026-10-22). Each block below pins a defect that the
// documentation-based version of this layer actually had.
// ===========================================================================================

/** A live-shaped payment, read newest-first — where BatchPaymentID IS populated. */
const LIVE_PAYMENT: XeroPayment = {
  PaymentID: "82be702a-fd1d-429b-8d3a-b10db62c7274",
  PaymentType: "ACCRECPAYMENT",
  Status: "AUTHORISED",
  Amount: 49.98,
  BankAmount: 49.98,
  CurrencyRate: 1,
  IsReconciled: true,
  Account: { AccountID: "02f08e19", Code: "616" },
  Invoice: { Type: "ACCREC", InvoiceID: "8e2d0a70", InvoiceNumber: "1233" },
  BatchPaymentID: "398a49ef-a1b4-4e3b-be76-20682d10d932",
} as XeroPayment;

/** A live-shaped batch: TotalAmount, never Amount. */
const LIVE_BATCH: XeroBatchPayment = {
  BatchPaymentID: "b1b51349",
  Type: "PAYBATCH",
  Status: "AUTHORISED",
  TotalAmount: 623,
  IsReconciled: true,
  ReconciledStatementLineId: "becbe490-ec60-4fcf-9dc2-51d74dffa94f",
  Payments: [
    { PaymentID: "52e731c6", Amount: 382.5 },
    { PaymentID: "4405533c", Amount: 2600.4 },
  ],
} as XeroBatchPayment;

const LIVE_OVERPAYMENT: XeroUnallocatedCredit = {
  OverpaymentID: "91a4948f",
  Type: "ACCPAYOVERPAYMENT",
  Status: "AUTHORISED",
  CurrencyCode: "GBP",
  Total: 64.99,
  RemainingCredit: 64.99,
} as XeroUnallocatedCredit;

describe("BatchPayment total — TotalAmount, not Amount", () => {
  // The original read `batch.Amount`, which live batches never send. toMoney(undefined)
  // returns zero rather than throwing, so all 1,421 of JENKI's batches would have normalised
  // to GBP 0.00 and summed to nothing, with no error anywhere.
  it("reads TotalAmount, the field Xero actually sends", () => {
    expect(normaliseBatchPayment(LIVE_BATCH, options).amount).toEqual({
      minor: 62300,
      currency: "GBP",
    });
  });

  it("does NOT silently normalise a live batch to zero", () => {
    expect(normaliseBatchPayment(LIVE_BATCH, options).amount.minor).not.toBe(0);
  });

  it("still accepts Amount as a fallback, for an org that sends it", () => {
    const legacy = { BatchPaymentID: "b", Type: "PAYBATCH", Amount: 10 } as XeroBatchPayment;
    expect(normaliseBatchPayment(legacy, options).amount).toEqual({ minor: 1000, currency: "GBP" });
  });

  it("prefers TotalAmount when both are present", () => {
    const both = { ...LIVE_BATCH, Amount: 1 } as XeroBatchPayment;
    expect(normaliseBatchPayment(both, options).amount).toEqual({ minor: 62300, currency: "GBP" });
  });

  it("FAILS LOUDLY when neither is present, rather than becoming zero", () => {
    const neither = { BatchPaymentID: "b", Type: "PAYBATCH" } as XeroBatchPayment;
    expect(() => normaliseBatchPayment(neither, options)).toThrow(
      /neither TotalAmount nor Amount/,
    );
  });
});

describe("BatchPayment currency — the bank account's, not the org's base", () => {
  // A batch carries no currency field of its own. Surveyed live 2026-10-27:
  // `Account.CurrencyCode` on 22 of 22 batches, nothing at the top level. Before this the
  // normaliser stamped every batch with the org base currency, which is indistinguishable
  // from correct while the two agree — and JENKI already holds Global Wallet bank accounts
  // in CAD, AUD, JPY and EUR, so they will not always agree.
  it("takes the currency from the batch's bank account", () => {
    const usd = {
      ...LIVE_BATCH,
      Account: { AccountID: "a1", CurrencyCode: "USD" },
    } as XeroBatchPayment;

    expect(normaliseBatchPayment(usd, options).amount).toEqual({
      minor: 62300,
      currency: "USD",
    });
  });

  it("falls back to the org base currency only when the account omits one", () => {
    const noCurrency = { ...LIVE_BATCH, Account: { AccountID: "a1" } } as XeroBatchPayment;

    expect(normaliseBatchPayment(noCurrency, options).amount.currency).toBe("GBP");
  });

  it("prefers DateString over the .NET Date, as parseXeroDate does elsewhere", () => {
    const dated = {
      ...LIVE_BATCH,
      Date: "/Date(1792972800000+0000)/",
      DateString: "2026-10-25T00:00:00",
    } as XeroBatchPayment;

    expect(normaliseBatchPayment(dated, options).paidAt).toBe("2026-10-25T00:00:00.000Z");
  });
});

describe("BankAmount — what actually hit the bank", () => {
  it("carries BankAmount alongside Amount", () => {
    const out = normalisePayment(LIVE_PAYMENT, options);
    expect(out.amount).toEqual({ minor: 4998, currency: "GBP" });
    expect(out.bankAmount).toEqual({ minor: 4998, currency: "GBP" });
  });

  it("keeps them distinct when a currency rate makes them diverge", () => {
    // Amount is in the invoice's currency, BankAmount in the bank account's. A cash position
    // has to use BankAmount, because that is the figure the statement will show.
    const fx = { ...LIVE_PAYMENT, Amount: 100, BankAmount: 73.58, CurrencyRate: 1.3591 };
    const out = normalisePayment(fx as XeroPayment, options);
    expect(out.amount).toEqual({ minor: 10000, currency: "GBP" });
    expect(out.bankAmount).toEqual({ minor: 7358, currency: "GBP" });
  });

  it("falls back to Amount rather than reporting zero when BankAmount is absent", () => {
    const noBank = { PaymentID: "p", PaymentType: "ACCRECPAYMENT", Amount: 12.34 };
    expect(normalisePayment(noBank as XeroPayment, options).bankAmount).toEqual({
      minor: 1234,
      currency: "GBP",
    });
  });
});

describe("the payment<->batch join, which runs BOTH ways", () => {
  /**
   * This block nearly asserted the opposite. A survey of `/Payments` page 1 found
   * BatchPaymentID on 0 of 100 records, so it was reported as a documentation-only field —
   * but page 1 is JENKI's oldest payments, from before they used batches. Read newest-first
   * it is on 200 of 200 as real GUIDs. The lesson is pinned here because the same trap
   * produced the opposite wrong answer about the /Payments overlap: on this API, page 1 is
   * the least representative sample available.
   */
  it("a payment names the batch it belongs to", () => {
    expect(normalisePayment(LIVE_PAYMENT, options).batchExternalId).toBe(
      "398a49ef-a1b4-4e3b-be76-20682d10d932",
    );
  });

  it("reports null for a payment that belongs to no batch", () => {
    const standalone = { PaymentID: "p", PaymentType: "ACCRECPAYMENT", Amount: 1 };
    expect(normalisePayment(standalone as XeroPayment, options).batchExternalId).toBeNull();
  });

  it("a batch is not itself inside a batch", () => {
    expect(normaliseBatchPayment(LIVE_BATCH, options).batchExternalId).toBeNull();
  });

  it("a batch names its member payments — the other direction of the same join", () => {
    expect(normaliseBatchPayment(LIVE_BATCH, options).memberPaymentIds).toEqual([
      "52e731c6",
      "4405533c",
    ]);
  });

  it("gives a dedupe key from either side of the /Payments overlap", () => {
    // Batch members are ALSO individual /Payments records -- 3 of 3 sampled resolved from
    // GET /Payments/{id}. Summing both endpoints double-counts. Either side can dedupe:
    // expand the batch's membership, or filter payments that name a batch.
    const ids = normaliseBatchPayment(LIVE_BATCH, options).memberPaymentIds;
    expect(ids).toEqual(["52e731c6", "4405533c"]);
    expect(normalisePayment(LIVE_PAYMENT, options).batchExternalId).not.toBeNull();
  });

  it("tolerates a batch whose members have no id", () => {
    const anon = { ...LIVE_BATCH, Payments: [{ Amount: 1 }] } as XeroBatchPayment;
    expect(normaliseBatchPayment(anon, options).memberPaymentIds).toEqual([]);
  });

  it("carries the reconciled statement line, present on 1,307 of 1,421", () => {
    expect(normaliseBatchPayment(LIVE_BATCH, options).statementLineExternalId).toBe(
      "becbe490-ec60-4fcf-9dc2-51d74dffa94f",
    );
  });
});

describe("amountIsLive — cancelled records keep their amounts", () => {
  // 100 of 100 sampled DELETED payments carried a non-zero Amount, and roughly a fifth of an
  // unfiltered /Payments read is DELETED. Summing without this counts cancelled money.
  it("is true for an AUTHORISED payment", () => {
    expect(normalisePayment(LIVE_PAYMENT, options).amountIsLive).toBe(true);
  });

  it("is false for a DELETED payment, which still reports its amount", () => {
    const deleted = { ...LIVE_PAYMENT, Status: "DELETED", Amount: 250, BankAmount: 250 };
    const out = normalisePayment(deleted as XeroPayment, options);
    expect(out.amountIsLive).toBe(false);
    // The figure is kept faithfully -- the flag says not to count it, not that it is absent.
    expect(out.amount).toEqual({ minor: 25000, currency: "GBP" });
  });

  it("is false for a DELETED batch payment", () => {
    const deleted = { ...LIVE_BATCH, Status: "DELETED" } as XeroBatchPayment;
    expect(normaliseBatchPayment(deleted, options).amountIsLive).toBe(false);
  });

  it("is false for a VOIDED overpayment", () => {
    const voided = { ...LIVE_OVERPAYMENT, Status: "VOIDED" } as XeroUnallocatedCredit;
    expect(normaliseUnallocatedCredit(voided, "OVERPAYMENT", options).amountIsLive).toBe(false);
  });

  it("is TRUE for a PAID overpayment — the money did move, it is just fully applied", () => {
    const paid = { ...LIVE_OVERPAYMENT, Status: "PAID", RemainingCredit: 0 };
    const out = normaliseUnallocatedCredit(paid as XeroUnallocatedCredit, "OVERPAYMENT", options);
    expect(out.amountIsLive).toBe(true);
    expect(out.creditIsLive).toBe(false);
  });
});

describe("creditIsLive — the VOIDED overpayment trap", () => {
  // 64 of 64 VOIDED overpayments keep a non-zero RemainingCredit; 0 of 36 PAID do. Identical
  // in shape to the VOIDED credit-note trap.
  it("is true for an AUTHORISED overpayment with real remaining credit", () => {
    const out = normaliseUnallocatedCredit(LIVE_OVERPAYMENT, "OVERPAYMENT", options);
    expect(out.creditIsLive).toBe(true);
    expect(out.remainingCredit).toEqual({ minor: 6499, currency: "GBP" });
  });

  it("is false for a VOIDED overpayment even though it reports remaining credit", () => {
    const voided = { ...LIVE_OVERPAYMENT, Status: "VOIDED" } as XeroUnallocatedCredit;
    const out = normaliseUnallocatedCredit(voided, "OVERPAYMENT", options);
    expect(out.creditIsLive).toBe(false);
    // Reported faithfully, so a cancelled credit with a stale balance stays visible as one.
    expect(out.remainingCredit).toEqual({ minor: 6499, currency: "GBP" });
  });

  it("is false for a plain payment, which holds no unapplied credit", () => {
    expect(normalisePayment(LIVE_PAYMENT, options).creditIsLive).toBe(false);
  });

  it("is false for a batch payment", () => {
    expect(normaliseBatchPayment(LIVE_BATCH, options).creditIsLive).toBe(false);
  });
});

describe("allocations and draw-down — was this credit consumed?", () => {
  const allocated = {
    ...LIVE_OVERPAYMENT,
    Status: "PAID",
    RemainingCredit: 0,
    Allocations: [
      {
        AllocationID: "8977bb3f",
        Amount: 146.53,
        Invoice: { InvoiceID: "0bcec34b", InvoiceNumber: "402383299" },
      },
    ],
    Payments: [{ PaymentID: "95f6a07c", Amount: 146.53 }],
  } as XeroUnallocatedCredit;

  it("normalises an allocation back to the invoice it was applied to", () => {
    const out = normaliseUnallocatedCredit(allocated, "OVERPAYMENT", options);
    expect(out.allocations).toEqual([
      {
        allocationId: "8977bb3f",
        invoiceExternalId: "0bcec34b",
        invoiceNumber: "402383299",
        amount: { minor: 14653, currency: "GBP" },
        allocatedAt: null,
      },
    ]);
  });

  it("records the payments that drew the credit down", () => {
    // Non-empty means consumed. A bare RemainingCredit cannot answer this.
    expect(
      normaliseUnallocatedCredit(allocated, "OVERPAYMENT", options).drawnDownByPaymentIds,
    ).toEqual(["95f6a07c"]);
  });

  it("reports an unconsumed credit as having neither", () => {
    const out = normaliseUnallocatedCredit(LIVE_OVERPAYMENT, "OVERPAYMENT", options);
    expect(out.allocations).toEqual([]);
    expect(out.drawnDownByPaymentIds).toEqual([]);
    expect(out.creditIsLive).toBe(true);
  });

  it("names the offending allocation when one fails to convert", () => {
    const bad = {
      ...LIVE_OVERPAYMENT,
      Allocations: [{ AllocationID: "a", Amount: 1.005 }],
    } as XeroUnallocatedCredit;
    expect(() => normaliseUnallocatedCredit(bad, "OVERPAYMENT", options)).toThrow(
      /Allocations\[0\]\.Amount/,
    );
  });

  it("leaves allocations empty for payments and batches", () => {
    expect(normalisePayment(LIVE_PAYMENT, options).allocations).toEqual([]);
    expect(normaliseBatchPayment(LIVE_BATCH, options).drawnDownByPaymentIds).toEqual([]);
  });
});

describe("payment types that only the live data revealed", () => {
  const typed = (PaymentType: string) =>
    normalisePayment({ PaymentID: "p", PaymentType, Amount: 1 } as XeroPayment, options);

  it("ARCREDITPAYMENT is OUTFLOW — a refund, not a receipt", () => {
    // The trap: "AR" reads as receivable, which reads as money in. It is backwards. These
    // records carry Invoice.Type = ACCRECCREDIT with a CN- number -- the Invoice field holds a
    // CREDIT NOTE, and paying a customer's credit note rather than allocating it is a refund.
    // 72 of the 1,000 payments in JENKI's live window are this type.
    expect(typed("ARCREDITPAYMENT").direction).toBe("OUTFLOW");
  });

  it("APCREDITPAYMENT is INFLOW — the mirror, a supplier refunding us", () => {
    expect(typed("APCREDITPAYMENT").direction).toBe("INFLOW");
  });

  it("does not let the ACCREC/ACCPAY prefix rule capture the credit-payment types", () => {
    // Guards the ordering inside toPaymentDirection: if the generic prefix rules ever move
    // above the exact matches, both of these flip and the error is a sign error in cash.
    expect(typed("ARCREDITPAYMENT").direction).not.toBe(typed("ACCRECPAYMENT").direction);
    expect(typed("APCREDITPAYMENT").direction).not.toBe(typed("ACCPAYPAYMENT").direction);
  });

  it("handles the overpayment/prepayment vocabulary, which is the BANK one", () => {
    // 5e35cd7 assumed ACCREC*/ACCPAY* prefixes here from documentation. Live overpayments use
    // SPEND-/RECEIVE-, so all 534 of JENKI's failed to normalise -- collected as failures
    // rather than thrown, so the reconciliation simply reported totals without them.
    const credit = (Type: string) =>
      normaliseUnallocatedCredit(
        { OverpaymentID: "o", Type, Total: 1, CurrencyCode: "GBP" } as XeroUnallocatedCredit,
        "OVERPAYMENT",
        options,
      );
    expect(credit("SPEND-OVERPAYMENT").direction).toBe("OUTFLOW");
    expect(credit("RECEIVE-OVERPAYMENT").direction).toBe("INFLOW");
    expect(credit("SPEND-PREPAYMENT").direction).toBe("OUTFLOW");
    expect(credit("RECEIVE-PREPAYMENT").direction).toBe("INFLOW");
  });

  it("still refuses a genuinely unknown type rather than defaulting it", () => {
    expect(() => typed("SOMETHING-NEW")).toThrow(/Unrecognised Xero payment type/);
  });
});
