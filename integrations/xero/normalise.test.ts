import { describe, expect, it } from "vitest";
import {
  normaliseAccount,
  normaliseBankTransaction,
  normaliseBankTransactions,
  normaliseInvoice,
  normaliseInvoices,
} from "./normalise";
import type { XeroAccount, XeroInvoice } from "./schemas";

/** A Xero-shaped sales invoice, as the Demo Company returns them. */
function invoice(overrides: Partial<XeroInvoice> = {}): XeroInvoice {
  return {
    InvoiceID: "8b4e1a3c-0000-4000-8000-000000000001",
    InvoiceNumber: "INV-0042",
    Type: "ACCREC",
    Status: "AUTHORISED",
    Contact: { ContactID: "c-1", Name: "Selfridges Retail Ltd" },
    Date: "/Date(1552262400000+0000)/",
    DateString: "2019-03-11T00:00:00",
    DueDate: "/Date(1554854400000+0000)/",
    DueDateString: "2019-04-10T00:00:00",
    CurrencyCode: "GBP",
    SubTotal: 1000,
    TotalTax: 200,
    Total: 1200,
    AmountDue: 1200,
    AmountPaid: 0,
    ...overrides,
  } as XeroInvoice;
}

describe("normaliseInvoice", () => {
  it("maps a sales invoice to an inflow commitment in integer pennies", () => {
    const result = normaliseInvoice(invoice(), { fallbackCurrency: "GBP" });

    expect(result.provider).toBe("XERO");
    expect(result.direction).toBe("INFLOW");
    expect(result.status).toBe("AUTHORISED");
    expect(result.documentNumber).toBe("INV-0042");
    expect(result.counterpartyName).toBe("Selfridges Retail Ltd");
    expect(result.issuedAt).toBe("2019-03-11T00:00:00.000Z");
    expect(result.dueAt).toBe("2019-04-10T00:00:00.000Z");
    expect(result.total).toEqual({ minor: 120000, currency: "GBP" });
    expect(result.amountDue).toEqual({ minor: 120000, currency: "GBP" });
    expect(result.amountPaid).toEqual({ minor: 0, currency: "GBP" });
  });

  it("maps a bill to an outflow", () => {
    expect(normaliseInvoice(invoice({ Type: "ACCPAY" }), { fallbackCurrency: "GBP" }).direction).toBe(
      "OUTFLOW",
    );
  });

  it("converts awkward decimals exactly", () => {
    const result = normaliseInvoice(
      invoice({ Total: 1234.55, AmountDue: 0.615 * 1000, AmountPaid: 1.1 }),
      { fallbackCurrency: "GBP" },
    );
    expect(result.total.minor).toBe(123455);
    expect(result.amountDue.minor).toBe(61500); // 0.615 * 1000 === 615.0000000000001 as a double
    expect(result.amountPaid.minor).toBe(110);
  });

  it("keeps partially-paid amounts consistent", () => {
    const result = normaliseInvoice(
      invoice({ Total: 1200, AmountPaid: 450.5, AmountDue: 749.5 }),
      { fallbackCurrency: "GBP" },
    );
    expect(result.amountPaid.minor + result.amountDue.minor).toBe(result.total.minor);
  });

  it("handles credit notes with negative totals", () => {
    const result = normaliseInvoice(invoice({ Total: -250.75, AmountDue: -250.75 }), {
      fallbackCurrency: "GBP",
    });
    expect(result.total.minor).toBe(-25075);
  });

  it("falls back to the org base currency when the invoice omits one", () => {
    const result = normaliseInvoice(invoice({ CurrencyCode: undefined }), {
      fallbackCurrency: "GBP",
    });
    expect(result.total.currency).toBe("GBP");
  });

  it("treats absent money fields as zero, not as missing", () => {
    const result = normaliseInvoice(
      invoice({ Total: undefined, AmountDue: undefined, AmountPaid: undefined }),
      { fallbackCurrency: "GBP" },
    );
    expect(result.total).toEqual({ minor: 0, currency: "GBP" });
  });

  it("surfaces an unmapped status instead of guessing", () => {
    const result = normaliseInvoice(invoice({ Status: "SOMETHING_NEW" }), {
      fallbackCurrency: "GBP",
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.providerStatus).toBe("SOMETHING_NEW");
  });

  it("refuses an unknown invoice type rather than defaulting the direction", () => {
    expect(() => normaliseInvoice(invoice({ Type: "ACCRECCREDIT_XX" }), { fallbackCurrency: "GBP" }))
      .toThrow(/Unrecognised Xero invoice type/);
  });

  it("refuses a currency we do not model", () => {
    expect(() => normaliseInvoice(invoice({ CurrencyCode: "XBT" }), { fallbackCurrency: "GBP" }))
      .toThrow(/Unsupported currency/);
  });
});

describe("normaliseInvoices", () => {
  it("reports bad records instead of dropping them", () => {
    const result = normaliseInvoices(
      [invoice(), invoice({ InvoiceID: "bad-1", Type: "NONSENSE" }), invoice({ InvoiceID: "ok-2" })],
      { fallbackCurrency: "GBP" },
    );

    expect(result.items).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.externalId).toBe("bad-1");
    expect(result.failures[0]!.reason).toMatch(/Unrecognised Xero invoice type/);
  });
});

describe("normaliseAccount", () => {
  const account: XeroAccount = {
    AccountID: "a-1",
    Code: "090",
    Name: "Business Bank Account",
    Type: "BANK",
    Class: "ASSET",
    Status: "ACTIVE",
    TaxType: "NONE",
    CurrencyCode: "GBP",
    BankAccountNumber: "12345678",
  } as XeroAccount;

  it("maps a bank account", () => {
    const result = normaliseAccount(account);
    expect(result.code).toBe("090");
    expect(result.isBankAccount).toBe(true);
    expect(result.currency).toBe("GBP");
  });

  it("does not lift the bank account number into the normalised model", () => {
    // Account PII with no forecasting use — it stays in `raw` for audit only.
    expect(Object.values(normaliseAccount(account))).not.toContain("12345678");
  });

  it("maps a nominal account with no currency of its own", () => {
    const result = normaliseAccount({
      AccountID: "a-2",
      Code: "200",
      Name: "Sales",
      Type: "REVENUE",
      Class: "REVENUE",
    } as XeroAccount);
    expect(result.isBankAccount).toBe(false);
    expect(result.currency).toBeNull();
  });
});

describe("normaliseBankTransaction", () => {
  const options = { fallbackCurrency: "GBP" as const };
  const base = {
    BankTransactionID: "bt-1",
    Type: "RECEIVE",
    Status: "AUTHORISED",
    CurrencyCode: "GBP",
    Total: 10,
  };

  it("maps every RECEIVE variant to INFLOW", () => {
    for (const type of ["RECEIVE", "RECEIVE-OVERPAYMENT", "RECEIVE-PREPAYMENT", "RECEIVE-TRANSFER"]) {
      expect(normaliseBankTransaction({ ...base, Type: type } as never, options).direction).toBe("INFLOW");
    }
  });

  it("maps every SPEND variant to OUTFLOW", () => {
    for (const type of ["SPEND", "SPEND-OVERPAYMENT", "SPEND-PREPAYMENT", "SPEND-TRANSFER"]) {
      expect(normaliseBankTransaction({ ...base, Type: type } as never, options).direction).toBe("OUTFLOW");
    }
  });

  it("throws on an unrecognised type rather than guessing a direction", () => {
    // A guessed direction flips cash in the forecast — the same reasoning as invoices.
    expect(() => normaliseBankTransaction({ ...base, Type: "MYSTERY" } as never, options)).toThrow(
      /Unrecognised Xero bank transaction type/,
    );
  });

  it("keeps the provider type verbatim so an unusual variant stays diagnosable", () => {
    const out = normaliseBankTransaction({ ...base, Type: "SPEND-TRANSFER" } as never, options);
    expect(out.providerType).toBe("SPEND-TRANSFER");
  });

  it("treats a missing IsReconciled as not reconciled", () => {
    expect(normaliseBankTransaction(base as never, options).isReconciled).toBe(false);
  });

  it("does not lift the bank account number into the model — it is PII with no forecasting use", () => {
    const out = normaliseBankTransaction(
      { ...base, BankAccount: { AccountID: "a", Name: "Current", BankAccountNumber: "12345678" } } as never,
      options,
    );
    expect(JSON.stringify({ ...out, raw: null })).not.toContain("12345678");
  });

  it("collects failures instead of dropping or throwing for the batch", () => {
    const result = normaliseBankTransactions(
      [base, { ...base, BankTransactionID: "bt-2", Type: "NONSENSE" }] as never,
      options,
    );
    expect(result.items).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.externalId).toBe("bt-2");
  });
});
