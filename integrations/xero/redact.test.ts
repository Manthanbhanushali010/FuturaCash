import { describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, redactForAudit } from "./redact";

/**
 * Synthetic throughout. `ACCOUNT_NUMBER` is 14 digits because that is the live shape, and the
 * tests assert on the string itself so a redaction that merely truncates still fails.
 */
const ACCOUNT_NUMBER = "99999999999999";
const PAYEE = "Zzyzx Synthetic Supplies Ltd";

describe("isSensitiveKey", () => {
  it.each([
    "BankAccountNumber",
    "BankAccountDetails",
    "AccountNumber",
    "RoutingCode",
    "SortCode",
    "IBAN",
    "SWIFT",
    "BIC",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it("matches case-insensitively, since an unsurveyed payload may not use PascalCase", () => {
    for (const key of ["bankaccountnumber", "BANKACCOUNTNUMBER", "BankAccountNUMBER"]) {
      expect(isSensitiveKey(key)).toBe(true);
    }
  });

  it("leaves fields we actually read alone", () => {
    // These are read in production: lifted into named fields, or used for `isBankAccount`.
    for (const key of ["BankAccount", "AccountID", "Code", "Name", "Type", "Amount"]) {
      expect(isSensitiveKey(key)).toBe(false);
    }
  });
});

describe("redactForAudit", () => {
  it("replaces a top-level bank account number", () => {
    const out = redactForAudit({ BankAccountNumber: ACCOUNT_NUMBER, Name: PAYEE });
    expect(out.BankAccountNumber).toBe(REDACTED);
    expect(out.Name).toBe(PAYEE);
    expect(JSON.stringify(out)).not.toContain(ACCOUNT_NUMBER);
  });

  it("reaches a number nested inside an inlined member array — the live shape", () => {
    const batch = {
      BatchPaymentID: "batch-1",
      TotalAmount: 300,
      Payments: [
        { PaymentID: "p-1", BankAmount: 100, BankAccountNumber: ACCOUNT_NUMBER },
        { PaymentID: "p-2", BankAmount: 200, BankAccountNumber: ACCOUNT_NUMBER },
      ],
    };
    const out = redactForAudit(batch);
    expect(JSON.stringify(out)).not.toContain(ACCOUNT_NUMBER);
    // The shape survives, so the payload is still worth auditing.
    expect(out.Payments).toHaveLength(2);
    expect(out.Payments[0]!.PaymentID).toBe("p-1");
    expect(out.Payments[0]!.BankAmount).toBe(100);
    expect(out.Payments[0]!.BankAccountNumber).toBe(REDACTED);
  });

  it("reaches arbitrary depth", () => {
    const deep = { a: { b: { c: [{ d: { BankAccountNumber: ACCOUNT_NUMBER } }] } } };
    expect(JSON.stringify(redactForAudit(deep))).not.toContain(ACCOUNT_NUMBER);
  });

  it("NEVER mutates the input — the payload is still in flight when this is called", () => {
    const batch = { Payments: [{ BankAccountNumber: ACCOUNT_NUMBER }] };
    redactForAudit(batch);
    expect(batch.Payments[0]!.BankAccountNumber).toBe(ACCOUNT_NUMBER);
  });

  it("keeps the key and marks it, rather than deleting it", () => {
    // Deleting would make "Xero sent nothing" and "we removed it" indistinguishable.
    const out = redactForAudit({ BankAccountNumber: ACCOUNT_NUMBER });
    expect(Object.keys(out)).toContain("BankAccountNumber");
    expect(out.BankAccountNumber).toBe(REDACTED);
  });

  it("leaves an absent value absent, rather than manufacturing a redaction", () => {
    const out = redactForAudit({ BankAccountNumber: null, AccountNumber: undefined });
    expect(out.BankAccountNumber).toBeNull();
    expect(out.AccountNumber).toBeUndefined();
  });

  it("preserves every non-sensitive value, including the ones we read back", () => {
    const account = {
      AccountID: "a-1",
      Code: "090",
      Name: "Business Current",
      Type: "BANK",
      CurrencyCode: "GBP",
      BankAccountNumber: ACCOUNT_NUMBER,
      BankAccount: { AccountID: "b-1", Name: "Current", Code: "090" },
    };
    const out = redactForAudit(account);
    expect(out.Type).toBe("BANK");
    expect(out.BankAccount).toEqual({ AccountID: "b-1", Name: "Current", Code: "090" });
    expect(out.BankAccountNumber).toBe(REDACTED);
  });

  it("passes primitives and null through untouched", () => {
    expect(redactForAudit(null)).toBeNull();
    expect(redactForAudit(undefined)).toBeUndefined();
    expect(redactForAudit(7)).toBe(7);
    expect(redactForAudit("x")).toBe("x");
    expect(redactForAudit(false)).toBe(false);
  });

  it("does not throw on a cyclic payload while building a failure record", () => {
    const cyclic: Record<string, unknown> = { BankAccountNumber: ACCOUNT_NUMBER };
    cyclic.self = cyclic;
    const out = redactForAudit(cyclic) as Record<string, unknown>;
    expect(out.BankAccountNumber).toBe(REDACTED);
    expect(out.self).toBe(out);
  });

  it("returns a Date as-is rather than copying it field by field", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const out = redactForAudit({ Date: date });
    expect(out.Date).toBeInstanceOf(Date);
    expect((out.Date as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
