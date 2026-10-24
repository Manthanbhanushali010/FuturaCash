import { describe, expect, it } from "vitest";

import { money } from "../../core/money";
import { reconcile, type ReconciliationInput } from "./reconcile";
import type { NormalisedBankTransaction, NormalisedProviderPayment } from "./types";
import type { NormalisedCommitment } from "../types";

/**
 * Reconciliation across the five endpoints, asserted against the overlaps measured on JENKI's
 * live data (2026-10-22/23) rather than against documentation.
 */

const EMPTY: ReconciliationInput = {
  payments: [],
  batchPayments: [],
  overpayments: [],
  prepayments: [],
  bankTransactions: [],
  commitments: [],
};

function payment(over: Partial<NormalisedProviderPayment> = {}): NormalisedProviderPayment {
  return {
    externalId: "p-1",
    provider: "XERO",
    source: "PAYMENT",
    direction: "OUTFLOW",
    providerType: "ACCPAYPAYMENT",
    status: "AUTHORISED",
    providerStatus: "AUTHORISED",
    reference: null,
    isReconciled: true,
    counterpartyName: null,
    documentNumber: null,
    documentExternalId: null,
    accountExternalId: null,
    accountCode: null,
    paidAt: "2026-10-01",
    currency: "GBP",
    amount: money(10000, "GBP"),
    bankAmount: money(10000, "GBP"),
    amountIsLive: true,
    creditIsLive: false,
    allocations: [],
    drawnDownByPaymentIds: [],
    memberPaymentIds: [],
    batchExternalId: null,
    statementLineExternalId: null,
    remainingCredit: money(0, "GBP"),
    raw: {},
    ...over,
  };
}

function bank(over: Partial<NormalisedBankTransaction> = {}): NormalisedBankTransaction {
  return {
    externalId: "bt-1",
    provider: "XERO",
    direction: "OUTFLOW",
    providerType: "SPEND",
    status: "AUTHORISED",
    providerStatus: "AUTHORISED",
    reference: null,
    description: null,
    isReconciled: true,
    counterpartyName: null,
    counterpartyExternalId: null,
    overpaymentExternalId: null,
    prepaymentExternalId: null,
    bankAccountExternalId: null,
    bankAccountName: null,
    bankAccountCode: null,
    bookedAt: "2026-10-01",
    currency: "GBP",
    subTotal: money(5000, "GBP"),
    totalTax: money(0, "GBP"),
    total: money(5000, "GBP"),
    raw: {},
    ...over,
  };
}

function commitment(over: Partial<NormalisedCommitment> = {}): NormalisedCommitment {
  return {
    externalId: "inv-1",
    provider: "XERO",
    documentNumber: "INV-1",
    reference: null,
    direction: "INFLOW",
    status: "AUTHORISED",
    providerStatus: "AUTHORISED",
    counterpartyName: null,
    counterpartyExternalId: null,
    issuedAt: "2026-09-01",
    dueAt: "2026-10-01",
    total: money(90000, "GBP"),
    amountDue: money(90000, "GBP"),
    amountPaid: money(0, "GBP"),
    raw: {},
    ...over,
  } as NormalisedCommitment;
}

function find<T extends { source: string; reason?: string }>(
  list: readonly T[],
  source: string,
  reason?: string,
): T | undefined {
  return list.find((l) => l.source === source && (reason === undefined || l.reason === reason));
}

describe("reconcile: nothing in, nothing claimed", () => {
  it("returns zero totals that tie out", () => {
    const result = reconcile(EMPTY);
    expect(result.tiesOut).toBe(true);
    expect(result.movement).toEqual({ INFLOW: [], OUTFLOW: [] });
    expect(result.counted).toEqual([]);
    expect(result.excluded).toEqual([]);
  });
});

describe("payments vs batch payments — the largest overlap", () => {
  // 3 of 3 sampled batch members resolved from GET /Payments/{id}; 61 of 100 records on page
  // 120 of /Payments are batch members. Counting both endpoints double-counts that money.
  const batch = payment({
    externalId: "b-1",
    source: "BATCH_PAYMENT",
    providerType: "PAYBATCH",
    amount: money(62300, "GBP"),
    bankAmount: money(62300, "GBP"),
    memberPaymentIds: ["p-1", "p-2"],
  });

  it("counts the batch once and excludes the member named by the batch", () => {
    const result = reconcile({ ...EMPTY, batchPayments: [batch], payments: [payment()] });
    expect(find(result.counted, "BATCH_PAYMENT")!.byCurrency).toEqual([money(62300, "GBP")]);
    expect(find(result.counted, "PAYMENT")).toBeUndefined();
    expect(find(result.excluded, "PAYMENT", "BATCH_MEMBER")!.byCurrency).toEqual([
      money(10000, "GBP"),
    ]);
    expect(result.tiesOut).toBe(true);
  });

  it("excludes a member that names its batch, even when the batch lists no members", () => {
    // The two join directions are independent; either may be the one Xero populated.
    const silent = { ...batch, memberPaymentIds: [] };
    const member = payment({ externalId: "p-9", batchExternalId: "b-1" });
    const result = reconcile({ ...EMPTY, batchPayments: [silent], payments: [member] });
    expect(find(result.excluded, "PAYMENT", "BATCH_MEMBER")!.count).toBe(1);
    expect(find(result.counted, "PAYMENT")).toBeUndefined();
  });

  it("does NOT exclude a payment whose batch is absent from this read", () => {
    // Dropping it would hide real money behind an assumption about data we do not have.
    const orphan = payment({ externalId: "p-7", batchExternalId: "b-missing" });
    const result = reconcile({ ...EMPTY, payments: [orphan] });
    expect(find(result.counted, "PAYMENT")!.byCurrency).toEqual([money(10000, "GBP")]);
    expect(result.tiesOut).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/names batch b-missing, which is not in this read/);
  });

  it("does not exclude a member of a CANCELLED batch, since that batch was never counted", () => {
    const dead = { ...batch, amountIsLive: false, providerStatus: "DELETED" };
    const result = reconcile({ ...EMPTY, batchPayments: [dead], payments: [payment()] });
    expect(find(result.excluded, "BATCH_PAYMENT", "CANCELLED")!.count).toBe(1);
    // The member still represents money that moved, so it is counted on its own.
    expect(find(result.counted, "PAYMENT")!.byCurrency).toEqual([money(10000, "GBP")]);
  });

  it("keeps a non-member payment", () => {
    const result = reconcile({ ...EMPTY, payments: [payment({ externalId: "p-solo" })] });
    expect(find(result.counted, "PAYMENT")!.count).toBe(1);
  });
});

describe("overpayments vs bank transactions", () => {
  const over = payment({
    externalId: "op-1",
    source: "OVERPAYMENT",
    providerType: "SPEND-OVERPAYMENT",
    amount: money(6499, "GBP"),
    bankAmount: money(6499, "GBP"),
    creditIsLive: true,
    remainingCredit: money(6499, "GBP"),
  });
  const bankRow = bank({
    externalId: "bt-over",
    providerType: "SPEND-OVERPAYMENT",
    overpaymentExternalId: "op-1",
    total: money(6499, "GBP"),
  });

  it("counts the overpayment and excludes the duplicate bank row", () => {
    // The overpayment is kept because it carries allocations and remaining credit; the bank
    // row carries only the movement.
    const result = reconcile({ ...EMPTY, overpayments: [over], bankTransactions: [bankRow] });
    expect(find(result.counted, "OVERPAYMENT")!.byCurrency).toEqual([money(6499, "GBP")]);
    expect(find(result.excluded, "BANK_TRANSACTION", "OVERPAYMENT_ALREADY_IN_BANK")!.count).toBe(1);
    expect(find(result.counted, "BANK_TRANSACTION")).toBeUndefined();
    expect(result.tiesOut).toBe(true);
  });

  it("matches on the LINK field, not the primary key", () => {
    // Xero gives the bank row a different id from the overpayment, so a primary-key join
    // would never find the overlap at all.
    expect(bankRow.externalId).not.toBe(over.externalId);
    const result = reconcile({ ...EMPTY, overpayments: [over], bankTransactions: [bankRow] });
    expect(find(result.excluded, "BANK_TRANSACTION", "OVERPAYMENT_ALREADY_IN_BANK")).toBeDefined();
  });

  it("counts a bank row whose overpayment is NOT in this read", () => {
    const orphan = bank({ externalId: "bt-x", overpaymentExternalId: "op-absent" });
    const result = reconcile({ ...EMPTY, bankTransactions: [orphan] });
    expect(find(result.counted, "BANK_TRANSACTION")!.count).toBe(1);
  });

  it("reports unapplied credit separately from movement, gated on creditIsLive", () => {
    const stale = {
      ...over,
      externalId: "op-void",
      creditIsLive: false,
      providerStatus: "VOIDED",
      amountIsLive: false,
    };
    const result = reconcile({ ...EMPTY, overpayments: [over, stale] });
    // Only the live one contributes credit, though both were presented.
    expect(result.availableCredit).toEqual([money(6499, "GBP")]);
    expect(find(result.excluded, "OVERPAYMENT", "CANCELLED")!.count).toBe(1);
  });
});

describe("internal transfers are excluded, and visibly so", () => {
  // 613 of the 1,000 rows in JENKI's live bank window are transfers, 307 in and 306 out.
  const out = bank({ externalId: "t-1", providerType: "SPEND-TRANSFER", direction: "OUTFLOW" });
  const back = bank({ externalId: "t-2", providerType: "RECEIVE-TRANSFER", direction: "INFLOW" });

  it("keeps both legs out of movement", () => {
    const result = reconcile({ ...EMPTY, bankTransactions: [out, back] });
    expect(result.movement).toEqual({ INFLOW: [], OUTFLOW: [] });
  });

  it("reports the excluded transfer total rather than absorbing it", () => {
    const result = reconcile({ ...EMPTY, bankTransactions: [out, back] });
    const line = find(result.excluded, "BANK_TRANSACTION", "INTERNAL_TRANSFER")!;
    expect(line.count).toBe(2);
    expect(line.byCurrency).toEqual([money(10000, "GBP")]);
    expect(result.tiesOut).toBe(true);
  });

  it("does not mistake a plain SPEND for a transfer", () => {
    const result = reconcile({ ...EMPTY, bankTransactions: [bank()] });
    expect(find(result.excluded, "BANK_TRANSACTION", "INTERNAL_TRANSFER")).toBeUndefined();
    expect(find(result.counted, "BANK_TRANSACTION")!.count).toBe(1);
  });
});

describe("cancelled records keep their amounts and must not be counted", () => {
  it("excludes a DELETED payment whose amount is still reported", () => {
    const dead = payment({ externalId: "p-del", amountIsLive: false, providerStatus: "DELETED" });
    const result = reconcile({ ...EMPTY, payments: [dead] });
    expect(find(result.counted, "PAYMENT")).toBeUndefined();
    expect(find(result.excluded, "PAYMENT", "CANCELLED")!.byCurrency).toEqual([
      money(10000, "GBP"),
    ]);
  });

  it("excludes a VOIDED bank transaction", () => {
    const voided = bank({ externalId: "bt-v", providerStatus: "VOIDED", status: "VOIDED" });
    const result = reconcile({ ...EMPTY, bankTransactions: [voided] });
    expect(find(result.excluded, "BANK_TRANSACTION", "CANCELLED")!.count).toBe(1);
  });
});

describe("invoices are reported, never added to cash movement", () => {
  it("keeps commitments out of movement entirely", () => {
    // An invoice is an obligation; a payment settles it. Adding both counts the same money
    // twice -- once promised, once moved.
    const result = reconcile({ ...EMPTY, commitments: [commitment()], payments: [payment()] });
    expect(result.movement.INFLOW).toEqual([]);
    expect(result.movement.OUTFLOW).toEqual([money(10000, "GBP")]);
    expect(result.committed.INFLOW).toEqual([money(90000, "GBP")]);
  });

  it("ignores a settled or cancelled commitment", () => {
    const result = reconcile({
      ...EMPTY,
      commitments: [commitment({ status: "PAID" }), commitment({ status: "VOIDED" })],
    });
    expect(result.committed).toEqual({ INFLOW: [], OUTFLOW: [] });
  });

  it("ignores a commitment credited to zero", () => {
    const result = reconcile({
      ...EMPTY,
      commitments: [commitment({ amountDue: money(0, "GBP") })],
    });
    expect(result.committed.INFLOW).toEqual([]);
  });
});

describe("currencies are grouped, never summed across", () => {
  it("keeps GBP and USD apart", () => {
    // Six of eight JENKI purchase orders are USD, so this is not hypothetical.
    const usd = payment({
      externalId: "p-usd",
      currency: "USD",
      amount: money(5000, "USD"),
      bankAmount: money(5000, "USD"),
    });
    const result = reconcile({ ...EMPTY, payments: [payment(), usd] });
    expect(result.movement.OUTFLOW).toEqual([money(10000, "GBP"), money(5000, "USD")]);
    expect(result.tiesOut).toBe(true);
  });
});

describe("tiesOut is arithmetic, not an opinion", () => {
  it("accounts for every record exactly once across counted and excluded", () => {
    const batch = payment({
      externalId: "b-1",
      source: "BATCH_PAYMENT",
      providerType: "PAYBATCH",
      memberPaymentIds: ["p-1"],
    });
    const input: ReconciliationInput = {
      ...EMPTY,
      batchPayments: [batch],
      payments: [payment(), payment({ externalId: "p-solo" }), payment({ externalId: "p-d", amountIsLive: false })],
      overpayments: [payment({ externalId: "op", source: "OVERPAYMENT", creditIsLive: true })],
      bankTransactions: [bank(), bank({ externalId: "t", providerType: "SPEND-TRANSFER" })],
    };
    const result = reconcile(input);

    const countedRecords = result.counted.reduce((n, l) => n + l.count, 0);
    const excludedRecords = result.excluded.reduce((n, l) => n + l.count, 0);
    const presented =
      input.payments.length +
      input.batchPayments.length +
      input.overpayments.length +
      input.prepayments.length +
      input.bankTransactions.length;

    expect(countedRecords + excludedRecords).toBe(presented);
    expect(result.tiesOut).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });

  it("separates an advisory warning from a broken total", () => {
    const result = reconcile({ ...EMPTY, payments: [payment({ batchExternalId: "b-gone" })] });
    expect(result.warnings).toHaveLength(1);
    // The arithmetic still ties, so tiesOut must stay true -- a caveat is not a defect.
    expect(result.tiesOut).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });
});

describe("upstream normalisation failures cannot hide behind a clean total", () => {
  it("breaks tiesOut when records never reached the reconciliation", () => {
    // Exactly what happened on the first live run: the arithmetic over what arrived balanced
    // perfectly while all 534 overpayments were missing, and tiesOut said true.
    const result = reconcile({
      ...EMPTY,
      payments: [payment()],
      failures: [{ source: "OVERPAYMENT", count: 534 }],
    });
    expect(result.tiesOut).toBe(false);
    expect(result.discrepancies.join(" ")).toMatch(
      /OVERPAYMENT: 534 record\(s\) failed normalisation/,
    );
  });

  it("names every affected source", () => {
    const result = reconcile({
      ...EMPTY,
      failures: [
        { source: "PAYMENT", count: 72 },
        { source: "OVERPAYMENT", count: 534 },
      ],
    });
    expect(result.discrepancies).toHaveLength(2);
    expect(result.tiesOut).toBe(false);
  });

  it("ignores a zero failure count", () => {
    const result = reconcile({ ...EMPTY, failures: [{ source: "PAYMENT", count: 0 }] });
    expect(result.tiesOut).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });

  it("ties out when no failures are supplied at all", () => {
    expect(reconcile({ ...EMPTY, payments: [payment()] }).tiesOut).toBe(true);
  });
});

describe("bounded reads are stated, not inferred", () => {
  it("warns for each truncated source without breaking tiesOut", () => {
    // Truncation is a completeness caveat, not an arithmetic fault: the numbers still add up,
    // they just do not cover the same period as a complete source alongside them.
    const result = reconcile({
      ...EMPTY,
      payments: [payment()],
      truncated: ["PAYMENT", "BANK_TRANSACTION"],
    });
    expect(result.tiesOut).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/PAYMENT: the read hit its page bound/);
    expect(result.warnings.join(" ")).toMatch(/no consistent period/);
  });

  it("says nothing when every read was complete", () => {
    expect(reconcile({ ...EMPTY, payments: [payment()] }).warnings).toEqual([]);
  });
});
