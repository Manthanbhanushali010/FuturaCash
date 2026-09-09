import { decimalToMinorUnits } from "../../core/decimal";
import { minorUnitDigits, money, parseCurrency, type CurrencyCode, type Money } from "../../core/money";
import type {
  CommitmentDirection,
  CommitmentStatus,
  NormalisationResult,
  NormalisedCommitment,
  NormalisedLedgerAccount,
} from "../types";
import { parseXeroDate } from "./dates";
import type { XeroAccount, XeroBankTransaction, XeroInvoice } from "./schemas";
import type { NormalisedBankTransaction } from "./types";

/**
 * Xero → internal model. This file is the anti-corruption boundary (invariant #6): past it,
 * nothing in the codebase knows the word "Xero". Everything here is pure — no I/O — so the
 * conversions can be asserted against golden values in evals/.
 */

/**
 * Xero's ACCREC/ACCPAY is the whole direction signal, so an unrecognised type is fatal for
 * that record rather than defaulted — guessing the direction would flip cash in the forecast.
 */
function toDirection(invoiceType: string): CommitmentDirection {
  switch (invoiceType) {
    case "ACCREC": // sales invoice — customer owes us
      return "INFLOW";
    case "ACCPAY": // bill — we owe a supplier
      return "OUTFLOW";
    default:
      throw new Error(`Unrecognised Xero invoice type "${invoiceType}"`);
  }
}

function toStatus(status: string): CommitmentStatus {
  switch (status) {
    case "DRAFT":
      return "DRAFT";
    case "SUBMITTED":
      return "SUBMITTED";
    case "AUTHORISED":
      return "AUTHORISED";
    case "PAID":
      return "PAID";
    case "VOIDED":
      return "VOIDED";
    case "DELETED":
      return "DELETED";
    default:
      return "UNKNOWN";
  }
}

/**
 * Convert a Xero money field to integer minor units.
 *
 * Totals and outstanding amounts are 2dp in Xero, so extra precision here means our
 * assumption is wrong and we stop (`rounding: "forbid"`) rather than quietly rounding.
 */
function toMoney(value: number | undefined, currency: CurrencyCode, field: string): Money {
  if (value === undefined) return money(0, currency);
  try {
    return money(decimalToMinorUnits(value, minorUnitDigits(currency)), currency);
  } catch (error) {
    throw new Error(`${field}: ${(error as Error).message}`);
  }
}

export interface NormaliseInvoiceOptions {
  /** Org base currency, used when an invoice omits CurrencyCode. */
  fallbackCurrency: CurrencyCode;
}

export function normaliseInvoice(
  invoice: XeroInvoice,
  options: NormaliseInvoiceOptions,
): NormalisedCommitment {
  const currency = invoice.CurrencyCode
    ? parseCurrency(invoice.CurrencyCode)
    : options.fallbackCurrency;

  return {
    externalId: invoice.InvoiceID,
    provider: "XERO",
    documentNumber: invoice.InvoiceNumber ?? null,
    reference: invoice.Reference ?? null,
    direction: toDirection(invoice.Type),
    status: toStatus(invoice.Status),
    providerStatus: invoice.Status,
    counterpartyName: invoice.Contact?.Name ?? null,
    counterpartyExternalId: invoice.Contact?.ContactID ?? null,
    issuedAt: parseXeroDate(invoice.Date, invoice.DateString),
    dueAt: parseXeroDate(invoice.DueDate, invoice.DueDateString),
    total: toMoney(invoice.Total, currency, "Total"),
    amountDue: toMoney(invoice.AmountDue, currency, "AmountDue"),
    amountPaid: toMoney(invoice.AmountPaid, currency, "AmountPaid"),
    raw: invoice,
  };
}

/**
 * Xero's Type is the whole direction signal for a bank transaction, so an unrecognised value
 * is fatal for that record rather than defaulted. Guessing would flip cash in the forecast —
 * the same reasoning as `toDirection` for invoices.
 *
 * The variants are real: an overpayment, a prepayment and a bank transfer each arrive as a
 * distinct Type, and all of them move money in a known direction.
 */
function toBankDirection(type: string): CommitmentDirection {
  if (type.startsWith("RECEIVE")) return "INFLOW";
  if (type.startsWith("SPEND")) return "OUTFLOW";
  throw new Error(`Unrecognised Xero bank transaction type "${type}"`);
}

export interface NormaliseBankTransactionOptions {
  /** Org base currency, used when a transaction omits CurrencyCode. */
  fallbackCurrency: CurrencyCode;
}

export function normaliseBankTransaction(
  transaction: XeroBankTransaction,
  options: NormaliseBankTransactionOptions,
): NormalisedBankTransaction {
  const currency = transaction.CurrencyCode
    ? parseCurrency(transaction.CurrencyCode)
    : options.fallbackCurrency;

  return {
    externalId: transaction.BankTransactionID,
    provider: "XERO",
    direction: toBankDirection(transaction.Type),
    providerType: transaction.Type,
    status: toStatus(transaction.Status ?? ""),
    providerStatus: transaction.Status ?? "",
    reference: transaction.Reference ?? null,
    description: firstDescription(transaction),
    // Absent means not reconciled — never assume a match we were not told about.
    isReconciled: transaction.IsReconciled ?? false,
    counterpartyName: transaction.Contact?.Name ?? null,
    counterpartyExternalId: transaction.Contact?.ContactID ?? null,
    bankAccountExternalId: transaction.BankAccount?.AccountID ?? null,
    bankAccountName: transaction.BankAccount?.Name ?? null,
    bankAccountCode: transaction.BankAccount?.Code ?? null,
    bookedAt: parseXeroDate(transaction.Date, transaction.DateString),
    currency,
    subTotal: toMoney(transaction.SubTotal, currency, "SubTotal"),
    totalTax: toMoney(transaction.TotalTax, currency, "TotalTax"),
    total: toMoney(transaction.Total, currency, "Total"),
    raw: transaction,
  };
}

/**
 * The first line item carrying a description.
 *
 * Bank transactions are usually single-line, so "first" is almost always "the only one".
 * Where there are several, joining them would produce a long unreadable cell and lose the
 * per-line amounts that give them meaning; showing the first matches what Xero's own bank
 * view leads with. Whitespace-only descriptions count as absent.
 */
function firstDescription(transaction: XeroBankTransaction): string | null {
  for (const line of transaction.LineItems ?? []) {
    const text = line.Description?.trim();
    if (text) return text;
  }
  return null;
}

export function normaliseBankTransactions(
  transactions: readonly XeroBankTransaction[],
  options: NormaliseBankTransactionOptions,
): NormalisationResult<NormalisedBankTransaction> {
  return collect(
    transactions,
    (transaction) => normaliseBankTransaction(transaction, options),
    (transaction) => transaction.BankTransactionID,
  );
}

export function normaliseAccount(account: XeroAccount): NormalisedLedgerAccount {
  return {
    externalId: account.AccountID,
    provider: "XERO",
    code: account.Code ?? null,
    name: account.Name,
    type: account.Type,
    classification: account.Class ?? null,
    status: account.Status ?? null,
    taxType: account.TaxType ?? null,
    // Xero omits CurrencyCode on non-bank accounts; those follow the org base currency.
    currency: account.CurrencyCode ? parseCurrency(account.CurrencyCode) : null,
    isBankAccount: account.Type === "BANK",
    // BankAccountNumber is deliberately NOT lifted into the normalised model — it is account
    // PII with no forecasting use. It stays in `raw` for audit only.
    raw: account,
  };
}

/**
 * Normalise a batch, collecting failures instead of throwing.
 *
 * One malformed invoice must not blank the whole position screen, and it must not vanish
 * either — the caller receives both halves and is expected to show the failures.
 */
export function normaliseInvoices(
  invoices: readonly XeroInvoice[],
  options: NormaliseInvoiceOptions,
): NormalisationResult<NormalisedCommitment> {
  return collect(invoices, (invoice) => normaliseInvoice(invoice, options), (invoice) => invoice.InvoiceID);
}

export function normaliseAccounts(
  accounts: readonly XeroAccount[],
): NormalisationResult<NormalisedLedgerAccount> {
  return collect(accounts, normaliseAccount, (account) => account.AccountID);
}

function collect<TRaw, TOut>(
  source: readonly TRaw[],
  map: (item: TRaw) => TOut,
  identify: (item: TRaw) => string | undefined,
): NormalisationResult<TOut> {
  const result: NormalisationResult<TOut> = { items: [], failures: [] };
  for (const item of source) {
    try {
      result.items.push(map(item));
    } catch (error) {
      result.failures.push({
        externalId: identify(item) ?? null,
        reason: (error as Error).message,
        raw: item,
      });
    }
  }
  return result;
}
