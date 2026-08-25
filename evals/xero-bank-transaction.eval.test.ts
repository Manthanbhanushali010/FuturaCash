import { describe, expect, it } from "vitest";
import golden from "./golden/xero-bank-transaction.golden.json";
import { normaliseBankTransaction, normaliseBankTransactions } from "../integrations/xero/normalise";
import type { XeroBankTransaction } from "../integrations/xero/schemas";
import type { CurrencyCode } from "../core/money";

/**
 * EVAL GATE — invariant #5.
 *
 * A bank transaction is the ledger's record of money actually moving. If the conversion from
 * Xero's JSON number to integer minor units drifts by a penny here, every downstream
 * reconciliation and forecast inherits it, and nothing else in the system will notice.
 *
 * A failure in this file fails CI. Do not adjust an expected value to make it pass — the
 * expected values are ground truth; the code is what moves.
 */

interface Expected {
  direction?: string;
  providerType?: string;
  status?: string;
  isReconciled?: boolean;
  counterpartyName?: string;
  bankAccountName?: string;
  bankAccountCode?: string;
  currency?: string;
  subTotalMinor?: number;
  totalTaxMinor?: number;
  totalMinor?: number;
}
interface Case { name: string; payload: Record<string, unknown>; expected: Expected }
interface Rejected { name: string; payload: Record<string, unknown>; reasonContains: string }

const fallbackCurrency = golden.fallbackCurrency as CurrencyCode;
const cases = golden.cases as Case[];
const rejected = golden.rejected as Rejected[];
const options = { fallbackCurrency };

describe("eval: Xero bank transaction normalisation", () => {
  it("has a non-trivial golden dataset", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(rejected.length).toBeGreaterThanOrEqual(4);
  });

  it("refuses extra precision rather than rounding it away", () => {
    // Xero sends 2dp. More precision means our assumption about the payload is wrong, and a
    // silently rounded penny is exactly the class of error the eval gate exists to prevent.
    // The naive-conversion hazards themselves are covered by xero-money.golden.json.
    const precision = rejected.filter((r) => r.reasonContains.includes("more precision"));
    expect(precision.length).toBeGreaterThanOrEqual(2);
  });

  it.each(cases)("$name", ({ payload, expected }) => {
    const actual = normaliseBankTransaction(payload as unknown as XeroBankTransaction, options);

    if (expected.direction !== undefined) expect(actual.direction).toBe(expected.direction);
    if (expected.providerType !== undefined) expect(actual.providerType).toBe(expected.providerType);
    if (expected.status !== undefined) expect(actual.status).toBe(expected.status);
    if (expected.isReconciled !== undefined) expect(actual.isReconciled).toBe(expected.isReconciled);
    if (expected.counterpartyName !== undefined) expect(actual.counterpartyName).toBe(expected.counterpartyName);
    if (expected.bankAccountName !== undefined) expect(actual.bankAccountName).toBe(expected.bankAccountName);
    if (expected.bankAccountCode !== undefined) expect(actual.bankAccountCode).toBe(expected.bankAccountCode);
    if (expected.currency !== undefined) expect(actual.total.currency).toBe(expected.currency);
    if (expected.subTotalMinor !== undefined) expect(actual.subTotal.minor).toBe(expected.subTotalMinor);
    if (expected.totalTaxMinor !== undefined) expect(actual.totalTax.minor).toBe(expected.totalTaxMinor);
    if (expected.totalMinor !== undefined) expect(actual.total.minor).toBe(expected.totalMinor);
  });

  it("every money value is an integer — never a float", () => {
    for (const testCase of cases) {
      const actual = normaliseBankTransaction(testCase.payload as unknown as XeroBankTransaction, options);
      for (const money of [actual.subTotal, actual.totalTax, actual.total]) {
        expect(Number.isInteger(money.minor)).toBe(true);
      }
    }
  });

  it.each(rejected)("rejects: $name", ({ payload, reasonContains }) => {
    expect(() =>
      normaliseBankTransaction(payload as unknown as XeroBankTransaction, options),
    ).toThrow(new RegExp(reasonContains));
  });

  it("reports failures rather than throwing or dropping them", () => {
    // One malformed row must neither blank the screen nor vanish from it.
    const mixed = [...cases.map((c) => c.payload), ...rejected.map((r) => r.payload)];
    const result = normaliseBankTransactions(mixed as unknown as XeroBankTransaction[], options);

    expect(result.items).toHaveLength(cases.length);
    expect(result.failures).toHaveLength(rejected.length);
    for (const failure of result.failures) {
      expect(failure.externalId).toBeTruthy();
      expect(failure.reason).toBeTruthy();
    }
  });
});
