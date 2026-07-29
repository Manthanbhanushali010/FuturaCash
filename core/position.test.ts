import { describe, expect, it } from "vitest";
import { outstandingByDirection } from "./position";
import type { CommitmentDirection, CommitmentStatus, NormalisedCommitment } from "../integrations/types";
import type { CurrencyCode } from "./money";

function commitment(
  direction: CommitmentDirection,
  status: CommitmentStatus,
  amountDueMinor: number,
  currency: CurrencyCode = "GBP",
): NormalisedCommitment {
  return {
    externalId: `${direction}-${status}-${amountDueMinor}-${currency}`,
    provider: "XERO",
    documentNumber: null,
    reference: null,
    direction,
    status,
    providerStatus: status,
    counterpartyName: null,
    counterpartyExternalId: null,
    issuedAt: null,
    dueAt: null,
    total: { minor: amountDueMinor, currency },
    amountDue: { minor: amountDueMinor, currency },
    amountPaid: { minor: 0, currency },
    raw: {},
  };
}

describe("outstandingByDirection", () => {
  it("sums authorised and submitted amounts per direction", () => {
    const result = outstandingByDirection([
      commitment("INFLOW", "AUTHORISED", 120000),
      commitment("INFLOW", "SUBMITTED", 5000),
      commitment("OUTFLOW", "AUTHORISED", 30000),
    ]);

    expect(result.INFLOW).toEqual([{ minor: 125000, currency: "GBP" }]);
    expect(result.OUTFLOW).toEqual([{ minor: 30000, currency: "GBP" }]);
  });

  it("excludes drafts — a draft is not an obligation", () => {
    expect(outstandingByDirection([commitment("INFLOW", "DRAFT", 99900)]).INFLOW).toEqual([]);
  });

  it("excludes paid documents so they cannot double-count against the bank feed", () => {
    expect(outstandingByDirection([commitment("INFLOW", "PAID", 99900)]).INFLOW).toEqual([]);
  });

  it("excludes voided, deleted and unrecognised statuses", () => {
    const result = outstandingByDirection([
      commitment("INFLOW", "VOIDED", 1000),
      commitment("INFLOW", "DELETED", 2000),
      commitment("INFLOW", "UNKNOWN", 4000),
    ]);
    expect(result.INFLOW).toEqual([]);
  });

  it("keeps currencies apart instead of adding them together", () => {
    const result = outstandingByDirection([
      commitment("INFLOW", "AUTHORISED", 10000, "GBP"),
      commitment("INFLOW", "AUTHORISED", 20000, "EUR"),
      commitment("INFLOW", "AUTHORISED", 5000, "GBP"),
    ]);

    // Two separate figures, never one meaningless total.
    expect(result.INFLOW).toEqual([
      { minor: 20000, currency: "EUR" },
      { minor: 15000, currency: "GBP" },
    ]);
  });

  it("handles credit notes that reduce the outstanding total", () => {
    const result = outstandingByDirection([
      commitment("INFLOW", "AUTHORISED", 100000),
      commitment("INFLOW", "AUTHORISED", -25000),
    ]);
    expect(result.INFLOW).toEqual([{ minor: 75000, currency: "GBP" }]);
  });

  it("returns empty buckets for no input rather than a zero figure", () => {
    // An empty list means "nothing outstanding", which must not render as a confident 0.00
    // in a currency nobody chose.
    expect(outstandingByDirection([])).toEqual({ INFLOW: [], OUTFLOW: [] });
  });

  it("ignores fully-settled documents with nothing left to pay", () => {
    expect(outstandingByDirection([commitment("OUTFLOW", "AUTHORISED", 0)]).OUTFLOW).toEqual([]);
  });
});
