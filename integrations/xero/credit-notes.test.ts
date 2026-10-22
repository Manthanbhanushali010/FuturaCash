import { describe, expect, it } from "vitest";

import { normaliseCreditNote, normaliseCreditNotes } from "./normalise";
import type { XeroCreditNote } from "./schemas";

/**
 * Credit notes, asserted against JENKI's real payloads (surveyed 2026-10-22) rather than
 * against documentation. The fixtures below are trimmed from actual records.
 */

const OPTIONS = { fallbackCurrency: "GBP" } as const;

/** A real AUTHORISED supplier credit: unapplied, nothing allocated against it. */
const AUTHORISED: XeroCreditNote = {
  CreditNoteID: "cn-auth-1",
  CreditNoteNumber: "GB6DV94ABEC",
  Type: "ACCPAYCREDIT",
  Status: "AUTHORISED",
  CurrencyCode: "GBP",
  CurrencyRate: 1,
  DateString: "2026-08-18T00:00:00",
  Total: 22.1,
  RemainingCredit: 22.1,
  Contact: { ContactID: "c-1", Name: "Diversey UK" },
  LineItems: [],
};

/** A real VOIDED credit note. Note the non-zero RemainingCredit -- this is the trap. */
const VOIDED: XeroCreditNote = {
  CreditNoteID: "cn-void-1",
  CreditNoteNumber: "CN-1494",
  Type: "ACCRECCREDIT",
  Status: "VOIDED",
  CurrencyCode: "GBP",
  Total: 7.8,
  RemainingCredit: 7.8,
  LineItems: [],
};

/** A real line item with tracking, exactly as Xero sends it. */
const TRACKED: XeroCreditNote = {
  CreditNoteID: "cn-tracked-1",
  CreditNoteNumber: "INV0057040",
  Reference: "Ubereats Sep",
  Type: "ACCRECCREDIT",
  Status: "PAID",
  CurrencyCode: "GBP",
  LineAmountTypes: "Inclusive",
  Total: 12.5,
  RemainingCredit: 0,
  LineItems: [
    {
      Description: "Plenish Berry Gut Health Shot 12 x\n60ml\n",
      Quantity: 1,
      UnitAmount: 0.01,
      LineAmount: 10,
      TaxAmount: 2.5,
      TaxType: "INPUT2",
      AccountCode: "300",
      AccountID: "acc-300",
      LineItemID: "li-1",
      Tracking: [
        {
          Name: "Site",
          Option: "Selfridges",
          TrackingCategoryID: "762a4fd1-014f-4c89-a05b-bd14ed4a00c2",
        },
        {
          Name: "Revenue Centre",
          Option: "Bars",
          TrackingCategoryID: "9b1c0000-0000-0000-0000-000000000001",
        },
      ],
    },
  ],
};

describe("credit note direction", () => {
  it("maps a customer credit to the receivables direction", () => {
    expect(normaliseCreditNote(TRACKED, OPTIONS).direction).toBe("INFLOW");
  });

  it("maps a supplier credit to the payables direction", () => {
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).direction).toBe("OUTFLOW");
  });

  it("refuses to guess an unrecognised type", () => {
    // Guessing would flip cash in the forecast, so this is fatal for the record.
    expect(() => normaliseCreditNote({ ...AUTHORISED, Type: "WHAT" }, OPTIONS)).toThrow(
      /Unrecognised Xero credit note type "WHAT"/,
    );
  });

  it("refuses a plain invoice type, which would mean the payload is not a credit note", () => {
    // ACCREC (no CREDIT suffix) arriving here means we are reading the wrong endpoint.
    expect(() => normaliseCreditNote({ ...AUTHORISED, Type: "ACCREC" }, OPTIONS)).toThrow(
      /Unrecognised Xero credit note type "ACCREC"/,
    );
  });

  it("keeps Xero's type verbatim, so an odd variant stays diagnosable", () => {
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).providerType).toBe("ACCPAYCREDIT");
  });
});

describe("creditIsLive -- the cancelled-credit trap", () => {
  // JENKI had 317 credit notes in 600 with a non-zero RemainingCredit, and every one of them
  // was VOIDED or DELETED. Summing the field without checking status invents available cash.
  it("marks an AUTHORISED credit note's remaining credit as real", () => {
    const note = normaliseCreditNote(AUTHORISED, OPTIONS);
    expect(note.creditIsLive).toBe(true);
    expect(note.remainingCredit).toEqual({ minor: 2210, currency: "GBP" });
  });

  it("does NOT treat a VOIDED credit note's remaining credit as real", () => {
    expect(normaliseCreditNote(VOIDED, OPTIONS).creditIsLive).toBe(false);
  });

  it("does NOT treat a DELETED credit note's remaining credit as real", () => {
    expect(normaliseCreditNote({ ...VOIDED, Status: "DELETED" }, OPTIONS).creditIsLive).toBe(false);
  });

  it("does NOT treat a PAID credit note as live credit -- it is fully applied", () => {
    expect(normaliseCreditNote(TRACKED, OPTIONS).creditIsLive).toBe(false);
  });

  it("reports the remaining credit faithfully even when it is not live", () => {
    // Zeroing it would hide the discrepancy. The flag says not to spend it; the figure stays
    // auditable so a cancelled credit note with a stale balance is still visible as one.
    const note = normaliseCreditNote(VOIDED, OPTIONS);
    expect(note.remainingCredit).toEqual({ minor: 780, currency: "GBP" });
    expect(note.creditIsLive).toBe(false);
  });

  it("treats SUBMITTED as live, matching the statuses the fetch requests", () => {
    expect(normaliseCreditNote({ ...AUTHORISED, Status: "SUBMITTED" }, OPTIONS).creditIsLive).toBe(
      true,
    );
  });
});

describe("credit note money", () => {
  it("converts totals to integer minor units", () => {
    expect(normaliseCreditNote(TRACKED, OPTIONS).total).toEqual({
      minor: 1250,
      currency: "GBP",
    });
  });

  it("refuses sub-penny precision rather than rounding it away", () => {
    expect(() => normaliseCreditNote({ ...AUTHORISED, Total: 22.105 }, OPTIONS)).toThrow(/Total/);
  });

  it("falls back to the org base currency when none is given", () => {
    const noCurrency: XeroCreditNote = { ...AUTHORISED };
    delete noCurrency.CurrencyCode;
    expect(normaliseCreditNote(noCurrency, OPTIONS).total.currency).toBe("GBP");
  });

  it("carries the currency rate, which a GBP-consolidated figure will need", () => {
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).currencyRate).toBe(1);
    expect(normaliseCreditNote({ ...AUTHORISED, CurrencyRate: 1.35916 }, OPTIONS).currencyRate).toBe(
      1.35916,
    );
  });
});

describe("tracking -- the reason this endpoint is worth reading", () => {
  it("normalises a line's tracking entries as Xero really sends them", () => {
    const [line] = normaliseCreditNote(TRACKED, OPTIONS).lines;
    expect(line!.tracking).toEqual([
      {
        category: "Site",
        option: "Selfridges",
        categoryId: "762a4fd1-014f-4c89-a05b-bd14ed4a00c2",
      },
      {
        category: "Revenue Centre",
        option: "Bars",
        categoryId: "9b1c0000-0000-0000-0000-000000000001",
      },
    ]);
  });

  it("groups the distinct options by category", () => {
    expect(normaliseCreditNote(TRACKED, OPTIONS).trackingByCategory).toEqual({
      Site: ["Selfridges"],
      "Revenue Centre": ["Bars"],
    });
  });

  it("de-duplicates an option repeated across lines", () => {
    const note = normaliseCreditNote(
      { ...TRACKED, LineItems: [TRACKED.LineItems![0]!, TRACKED.LineItems![0]!] },
      OPTIONS,
    );
    expect(note.trackingByCategory["Site"]).toEqual(["Selfridges"]);
  });

  it("collects several options within one category across lines", () => {
    const second = {
      ...TRACKED.LineItems![0]!,
      LineItemID: "li-2",
      Tracking: [{ Name: "Site", Option: "Borough Market", TrackingCategoryID: "762a4fd1" }],
    };
    const note = normaliseCreditNote({ ...TRACKED, LineItems: [TRACKED.LineItems![0]!, second] }, OPTIONS);
    expect(note.trackingByCategory["Site"]).toEqual(["Selfridges", "Borough Market"]);
  });

  it("keeps a retired option verbatim rather than deciding it is retired", () => {
    // JENKI's real data contains options prefixed `DO NOT USE\old:`. Excluding them is a
    // grouping decision for a display layer; the normaliser must not silently drop history.
    const line = {
      ...TRACKED.LineItems![0]!,
      Tracking: [{ Name: "Site", Option: "DO NOT USE\\old:Head office - CPU" }],
    };
    const note = normaliseCreditNote({ ...TRACKED, LineItems: [line] }, OPTIONS);
    expect(note.lines[0]!.tracking[0]!.option).toBe("DO NOT USE\\old:Head office - CPU");
  });

  it("tolerates an absent option id, which Xero never sends on a line", () => {
    const line = { ...TRACKED.LineItems![0]!, Tracking: [{ Name: "Site", Option: "CPU" }] };
    const note = normaliseCreditNote({ ...TRACKED, LineItems: [line] }, OPTIONS);
    expect(note.lines[0]!.tracking[0]!.categoryId).toBeNull();
  });

  it("skips an incomplete tracking entry without discarding the credit note", () => {
    // 9% of JENKI's line items have no tracking at all; a half-populated entry carries no
    // information either, and losing the whole record over it would be worse.
    const line = {
      ...TRACKED.LineItems![0]!,
      Tracking: [{ Name: "Site" }, { Option: "Orphan" }, { Name: "Site", Option: "CPU" }],
    };
    const note = normaliseCreditNote({ ...TRACKED, LineItems: [line] }, OPTIONS);
    expect(note.lines[0]!.tracking).toEqual([
      { category: "Site", option: "CPU", categoryId: null },
    ]);
  });

  it("reports no tracking as an empty map, not as a missing field", () => {
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).trackingByCategory).toEqual({});
  });
});

describe("credit note lines", () => {
  it("converts line and tax amounts to integer minor units", () => {
    const [line] = normaliseCreditNote(TRACKED, OPTIONS).lines;
    expect(line!.lineAmount).toEqual({ minor: 1000, currency: "GBP" });
    expect(line!.taxAmount).toEqual({ minor: 250, currency: "GBP" });
  });

  it("does not convert UnitAmount, which Xero allows at four decimal places", () => {
    // Converting it under rounding: "forbid" would manufacture failures for a figure nothing
    // needs. It stays in `raw`. A 4dp unit price must not break the record.
    const line = { ...TRACKED.LineItems![0]!, UnitAmount: 0.0125 };
    const note = normaliseCreditNote({ ...TRACKED, LineItems: [line] }, OPTIONS);
    expect(note.lines[0]!.lineAmount).toEqual({ minor: 1000, currency: "GBP" });
    expect(note.lines[0]).not.toHaveProperty("unitAmount");
  });

  it("keeps a fractional quantity as a number, because a quantity is not money", () => {
    const line = { ...TRACKED.LineItems![0]!, Quantity: 2.5 };
    const note = normaliseCreditNote({ ...TRACKED, LineItems: [line] }, OPTIONS);
    expect(note.lines[0]!.quantity).toBe(2.5);
  });

  it("names the offending line when one fails to convert", () => {
    const line = { ...TRACKED.LineItems![0]!, LineAmount: 10.005 };
    expect(() => normaliseCreditNote({ ...TRACKED, LineItems: [line] }, OPTIONS)).toThrow(
      /LineItems\[0\]\.LineAmount/,
    );
  });

  it("reports an empty line list rather than inventing a line", () => {
    // This is also what an unpaginated fetch produces -- see fetchCreditNotes.
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).lines).toEqual([]);
  });
});

describe("credit note identity and dates", () => {
  it("carries the document number, reference and counterparty", () => {
    const note = normaliseCreditNote(TRACKED, OPTIONS);
    expect(note.documentNumber).toBe("INV0057040");
    expect(note.reference).toBe("Ubereats Sep");
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).counterpartyName).toBe("Diversey UK");
  });

  it("parses the issue date", () => {
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).issuedAt).toMatch(/^2026-08-18/);
  });

  it("reports an absent due date as null -- 91% of JENKI's lack one", () => {
    expect(normaliseCreditNote(AUTHORISED, OPTIONS).dueAt).toBeNull();
  });
});

describe("normaliseCreditNotes", () => {
  it("collects per-record failures instead of losing the whole batch", () => {
    const result = normaliseCreditNotes([AUTHORISED, { ...VOIDED, Type: "NONSENSE" }], OPTIONS);
    expect(result.items).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.externalId).toBe("cn-void-1");
    expect(result.failures[0]!.reason).toMatch(/NONSENSE/);
  });

  it("normalises an empty batch without complaint", () => {
    expect(normaliseCreditNotes([], OPTIONS)).toEqual({ items: [], failures: [] });
  });
});
