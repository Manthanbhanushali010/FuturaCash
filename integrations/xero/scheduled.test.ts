import { describe, expect, it } from "vitest";

import { money } from "../../core/money";
import { buildBatchPaymentCard } from "./batch-card";
import { DEFAULT_ORG_TIME_ZONE } from "./config";
import { calendarDateIn } from "./dates";
import { normaliseBatchPayments } from "./normalise";
import { reconcile, type ReconciliationInput } from "./reconcile";
import type { XeroBatchPayment } from "./schemas";
import type { NormalisedBankTransaction, NormalisedProviderPayment } from "./types";

/**
 * Scheduled (future-dated) money, and the single figure it must agree with.
 *
 * Measured on JENKI 2026-10-27: two authorised batches dated 2026-10-30 and 2026-11-02, worth
 * 100,324.65 GBP together, were counted as cash that had moved. The reconciliation's window is
 * a `Date>=` predicate with no upper bound, so a scheduled payment sits inside it looking
 * exactly like a settled one.
 */

const EMPTY: Omit<ReconciliationInput, "asOf"> = {
  payments: [],
  batchPayments: [],
  overpayments: [],
  prepayments: [],
  bankTransactions: [],
  commitments: [],
};

const AS_OF = "2026-10-27";

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
    paidAt: "2026-10-20T00:00:00.000Z",
    currency: "GBP",
    amount: money(10_000, "GBP"),
    bankAmount: money(10_000, "GBP"),
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
    counterpartyName: null,
    bankAccountExternalId: null,
    bankAccountName: null,
    bookedAt: "2026-10-20T00:00:00.000Z",
    currency: "GBP",
    total: money(5_000, "GBP"),
    totalTax: money(0, "GBP"),
    subTotal: money(5_000, "GBP"),
    isReconciled: true,
    overpaymentExternalId: null,
    prepaymentExternalId: null,
    raw: {},
    ...over,
  } as NormalisedBankTransaction;
}

const minorOf = (list: readonly { currency: string; minor: number }[], currency = "GBP") =>
  list.find((m) => m.currency === currency)?.minor ?? 0;

describe("asOf is required, injected, and a calendar date", () => {
  it("rejects a timestamp, which would mark the whole window as future-dated", () => {
    expect(() => reconcile({ ...EMPTY, asOf: "2026-10-27T16:57:00.000Z" })).toThrow(
      /calendar date/,
    );
  });

  it("rejects a malformed date rather than falling back to anything", () => {
    expect(() => reconcile({ ...EMPTY, asOf: "27/10/2026" })).toThrow(/calendar date/);
  });

  it("echoes asOf back, so a stored figure records which day it was computed against", () => {
    expect(reconcile({ ...EMPTY, asOf: AS_OF }).asOf).toBe(AS_OF);
  });
});

describe("future-dated records are reported, not counted", () => {
  it("routes a future-dated payment to scheduled and keeps it out of movement", () => {
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      payments: [
        payment({ externalId: "past", paidAt: "2026-10-20T00:00:00.000Z" }),
        payment({ externalId: "future", paidAt: "2026-10-30T00:00:00.000Z" }),
      ],
    });

    expect(minorOf(result.movement.OUTFLOW)).toBe(10_000);
    expect(minorOf(result.scheduledMovement.OUTFLOW)).toBe(10_000);
    expect(result.scheduled).toEqual([
      { source: "PAYMENT", count: 1, byCurrency: [money(10_000, "GBP")] },
    ]);
    expect(result.tiesOut).toBe(true);
    expect(result.discrepancies).toEqual([]);
  });

  it("counts a record dated ON asOf — today's trading is not the future", () => {
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      payments: [payment({ paidAt: "2026-10-27T00:00:00.000Z" })],
    });

    expect(minorOf(result.movement.OUTFLOW)).toBe(10_000);
    expect(result.scheduled).toEqual([]);
  });

  it("routes a future-dated BANK row to scheduled, not assuming bank rows are always past", () => {
    // Probed live on 2026-10-27: no bank row was future-dated that day. That is a measurement
    // of one day's data, not a guarantee — a spend-money record's date is user-set — so the
    // rule applies to every source rather than only the one caught misbehaving.
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      bankTransactions: [bank({ bookedAt: "2026-11-02T00:00:00.000Z" })],
    });

    expect(minorOf(result.movement.OUTFLOW)).toBe(0);
    expect(minorOf(result.scheduledMovement.OUTFLOW)).toBe(5_000);
    expect(result.tiesOut).toBe(true);
  });

  it("counts an UNDATED record rather than guessing it is scheduled, and WARNS", () => {
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      payments: [payment({ externalId: "p-nodate", paidAt: null })],
    });

    expect(minorOf(result.movement.OUTFLOW)).toBe(10_000);
    expect(result.scheduled).toEqual([]);
    // Counted is the conservative choice; silent would make that choice look like a
    // measurement. It is the one record classified on an absence rather than a value.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("p-nodate");
    expect(result.warnings[0]).toContain("no date");
    expect(result.warnings[0]).toContain(AS_OF);
    // A warning, never a discrepancy: the arithmetic still ties.
    expect(result.discrepancies).toEqual([]);
    expect(result.tiesOut).toBe(true);
  });

  it("warns per undated record and names its source", () => {
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      payments: [payment({ externalId: "p-nodate", paidAt: null })],
      bankTransactions: [bank({ externalId: "bt-nodate", bookedAt: null })],
    });

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.some((w) => w.startsWith("PAYMENT p-nodate"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("BANK_TRANSACTION bt-nodate"))).toBe(true);
  });

  it("does not warn when every record is dated", () => {
    const result = reconcile({ ...EMPTY, asOf: AS_OF, payments: [payment()] });

    expect(result.warnings).toEqual([]);
  });

  it("keeps a scheduled record out of every period slice", () => {
    // A period total must not include money that has not moved. `unattributed` is not a
    // dumping ground for it either — a scheduled record is not an unattributed one.
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      payments: [payment({ paidAt: "2026-10-30T00:00:00.000Z" })],
      periods: [{ label: "last 30 days", since: "2026-09-27" }],
    });

    expect(result.byPeriod[0]?.count).toBe(0);
    expect(minorOf(result.byPeriod[0]?.movement.OUTFLOW ?? [])).toBe(0);
    expect(result.unattributed).toBeNull();
  });
});

describe("the dedupe must see every record, including the scheduled ones", () => {
  /** A scheduled batch and the member payments it names — the live shape, in miniature. */
  const scheduledBatch = (): NormalisedProviderPayment =>
    payment({
      externalId: "batch-future",
      source: "BATCH_PAYMENT",
      providerType: "PAYBATCH",
      paidAt: "2026-10-30T00:00:00.000Z",
      amount: money(30_000, "GBP"),
      bankAmount: money(30_000, "GBP"),
      memberPaymentIds: ["m-1", "m-2", "m-3"],
    });

  const members = (): NormalisedProviderPayment[] =>
    ["m-1", "m-2", "m-3"].map((id) =>
      payment({
        externalId: id,
        paidAt: "2026-10-30T00:00:00.000Z",
        amount: money(10_000, "GBP"),
        bankAmount: money(10_000, "GBP"),
        batchExternalId: "batch-future",
      }),
    );

  it("still excludes the members of a SCHEDULED batch, so nothing is counted twice", () => {
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      batchPayments: [scheduledBatch()],
      payments: members(),
    });

    // The batch is scheduled; its three members are deduped away as before.
    expect(minorOf(result.scheduledMovement.OUTFLOW)).toBe(30_000);
    expect(minorOf(result.movement.OUTFLOW)).toBe(0);
    const batchMember = result.excluded.find((e) => e.reason === "BATCH_MEMBER");
    expect(batchMember?.count).toBe(3);
    expect(minorOf(batchMember?.byCurrency ?? [])).toBe(30_000);
    // No "names a batch we never read" warning: the batch IS in the read, merely scheduled.
    expect(result.warnings).toEqual([]);
    expect(result.tiesOut).toBe(true);
  });

  it("would double-count if the batch were filtered out of the input instead", () => {
    // The measured trap, in miniature. Dropping the future-dated batch before the dedupe
    // leaves its members unrecognised, so they are counted individually and OUT is unchanged
    // — on live data that moved 100,324.65 GBP from BATCH_PAYMENT into PAYMENT and changed
    // the net by nothing at all.
    const filtered = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      batchPayments: [],
      payments: members(),
    });

    expect(minorOf(filtered.scheduledMovement.OUTFLOW)).toBe(30_000);
    expect(filtered.excluded.find((e) => e.reason === "BATCH_MEMBER")).toBeUndefined();
    expect(filtered.warnings).toHaveLength(3);
  });
});

describe("asOf must be computed in the organisation's timezone, not UTC", () => {
  // 00:30 BST on 15 July 2026 is 23:30 UTC on 14 July. BST is deliberately mid-summer: the
  // UK leaves BST on 25 October 2026, so a late-October "00:30 BST" would be GMT and would
  // not exercise this at all.
  const DURING_BST = new Date("2026-07-14T23:30:00.000Z");

  it("reads 15 July in Europe/London where UTC still reads 14 July", () => {
    expect(calendarDateIn(DEFAULT_ORG_TIME_ZONE, DURING_BST)).toBe("2026-07-15");
    expect(calendarDateIn("UTC", DURING_BST)).toBe("2026-07-14");
  });

  it("counts today's trading at 00:30 BST, which a UTC asOf would call the future", () => {
    const todaysPayment = payment({ paidAt: "2026-07-15T00:00:00.000Z" });

    const london = reconcile({
      ...EMPTY,
      asOf: calendarDateIn(DEFAULT_ORG_TIME_ZONE, DURING_BST),
      payments: [todaysPayment],
    });
    const utc = reconcile({
      ...EMPTY,
      asOf: calendarDateIn("UTC", DURING_BST),
      payments: [todaysPayment],
    });

    expect(minorOf(london.movement.OUTFLOW)).toBe(10_000);
    expect(minorOf(london.scheduledMovement.OUTFLOW)).toBe(0);

    // The defect, stated rather than implied: computed in UTC, a whole day's real movement
    // is reported as money that has not moved yet.
    expect(minorOf(utc.movement.OUTFLOW)).toBe(0);
    expect(minorOf(utc.scheduledMovement.OUTFLOW)).toBe(10_000);
  });

  it("agrees with UTC outside BST, so the fix is not a blanket day shift", () => {
    const inGmt = new Date("2026-12-14T23:30:00.000Z");
    expect(calendarDateIn(DEFAULT_ORG_TIME_ZONE, inGmt)).toBe("2026-12-14");
    expect(calendarDateIn("UTC", inGmt)).toBe("2026-12-14");
  });

  it("throws on an unknown timezone rather than falling back to UTC", () => {
    expect(() => calendarDateIn("Europe/Nowhere", DURING_BST)).toThrow();
  });
});

describe("the page can never show two different scheduled totals", () => {
  /**
   * The cross-check. The batch card and the reconciliation derive "scheduled" independently —
   * the card from `isScheduled` on its own rows, the reconciliation from `asOf` inside
   * `count()` — and both appear on `/xero`. Two figures disagreeing on one screen is worse
   * than either being wrong alone, so they are asserted equal over one fixture.
   */
  const raw = (over: Partial<XeroBatchPayment> = {}): XeroBatchPayment =>
    ({
      BatchPaymentID: "b-1",
      Type: "PAYBATCH",
      Status: "AUTHORISED",
      DateString: "2026-10-20T00:00:00",
      TotalAmount: 300,
      Account: { AccountID: "a-1", CurrencyCode: "GBP" },
      Payments: [
        { PaymentID: "p-1", Amount: 100, BankAmount: 100 },
        { PaymentID: "p-2", Amount: 200, BankAmount: 200 },
      ],
      ...over,
    }) as XeroBatchPayment;

  const FIXTURE: XeroBatchPayment[] = [
    raw({ BatchPaymentID: "paid", DateString: "2026-10-20T00:00:00", TotalAmount: 300 }),
    raw({
      BatchPaymentID: "sched-1",
      DateString: "2026-10-30T00:00:00",
      TotalAmount: 84_109.55,
      Payments: [{ PaymentID: "s-1", Amount: 84_109.55, BankAmount: 84_109.55 }],
    }),
    raw({
      BatchPaymentID: "sched-2",
      DateString: "2026-11-02T00:00:00",
      TotalAmount: 16_215.1,
      Payments: [{ PaymentID: "s-2", Amount: 16_215.1, BankAmount: 16_215.1 }],
    }),
  ];

  it("the card's scheduled total equals the reconciliation's scheduled batch total", () => {
    const card = buildBatchPaymentCard(FIXTURE, {
      fallbackCurrency: "GBP",
      // The same instant the reconciliation's asOf is derived from, so the comparison is of
      // the two classifications and not of two different notions of "now".
      now: new Date(`${AS_OF}T12:00:00.000Z`),
    });

    const normalised = normaliseBatchPayments(FIXTURE, { fallbackCurrency: "GBP" });
    expect(normalised.failures).toEqual([]);

    const result = reconcile({ ...EMPTY, asOf: AS_OF, batchPayments: normalised.items });

    const cardScheduled = card.scheduledSubtotals.reduce(
      (total, subtotal) => total + subtotal.outflow.minor,
      0,
    );
    const reconciledScheduled = minorOf(result.scheduledMovement.OUTFLOW);

    // 84,109.55 + 16,215.10 — the live figure, to the penny.
    expect(cardScheduled).toBe(10_032_465);
    expect(reconciledScheduled).toBe(cardScheduled);

    // And the paid side agrees too, so the equality is not an artefact of both being zero.
    const cardPaid = card.subtotals.reduce((total, s) => total + s.outflow.minor, 0);
    expect(cardPaid).toBe(30_000);
    expect(minorOf(result.movement.OUTFLOW)).toBe(cardPaid);
  });

  it("stays equal when NOTHING is scheduled", () => {
    const onlyPaid = [FIXTURE[0]!];
    const card = buildBatchPaymentCard(onlyPaid, {
      fallbackCurrency: "GBP",
      now: new Date(`${AS_OF}T12:00:00.000Z`),
    });
    const result = reconcile({
      ...EMPTY,
      asOf: AS_OF,
      batchPayments: normaliseBatchPayments(onlyPaid, { fallbackCurrency: "GBP" }).items,
    });

    expect(card.scheduled).toEqual([]);
    expect(result.scheduled).toEqual([]);
    expect(minorOf(result.movement.OUTFLOW)).toBe(30_000);
  });
});
