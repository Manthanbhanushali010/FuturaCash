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
 * The payment family. Built from Xero's documented fields, NOT from a survey of JENKI's data —
 * the grant did not hold `accounting.payments.read` when these were written, so all four
 * endpoints returned 401. Display choices downstream are provisional until that survey runs;
 * the behaviours asserted here are contract-level and should hold regardless.
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
